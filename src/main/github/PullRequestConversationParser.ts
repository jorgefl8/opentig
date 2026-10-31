import { z } from 'zod';
import type { PullRequestConversation, PullRequestConversationEntry, PullRequestReviewVerdict } from '../../shared/contracts';
import { isWithheldField, participant, participantSchema } from './PullRequestLiveStateParser';

/** GraphQL rather than `gh pr view`, whose JSON doesn't say which authors are bots. */
export const PR_CONVERSATION_QUERY = `query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){pullRequest(number:$number){
    comments(last:100){pageInfo{hasPreviousPage} nodes{id body createdAt url isMinimized author{__typename login avatarUrl}}}
    reviews(last:100){pageInfo{hasPreviousPage} nodes{id state body submittedAt createdAt url isMinimized author{__typename login avatarUrl}}}
  }}
}`;

const connection = <T extends z.ZodType>(node: T) => z.object({ pageInfo: z.object({ hasPreviousPage: z.boolean() }), nodes: z.array(node.nullable()).nullish() });
const responseSchema = z.object({
  data: z.object({ repository: z.object({ pullRequest: z.object({
    comments: connection(z.object({ id: z.string(), body: z.string(), createdAt: z.string(), url: z.string().nullish(), isMinimized: z.boolean().nullish(), author: participantSchema.nullish() })).nullish(),
    reviews: connection(z.object({ id: z.string(), state: z.string(), body: z.string().nullish(), submittedAt: z.string().nullish(), createdAt: z.string().nullish(), url: z.string().nullish(), isMinimized: z.boolean().nullish(), author: participantSchema.nullish() })).nullish(),
  }).nullable() }) }),
  errors: z.array(z.object({ type: z.string().nullish(), path: z.array(z.union([z.string(), z.number()])).nullish() })).optional(),
});

const VERDICTS: ReadonlySet<string> = new Set<PullRequestReviewVerdict>(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED']);

/** Null when the response can't be used, so the command's stderr can explain why. Withheld fields keep the rest readable. */
export function parsePullRequestConversation(raw: string): PullRequestConversation | null {
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return null; }
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) return null;
  const { errors = [] } = parsed.data;
  const pull = parsed.data.data.repository.pullRequest;
  if (!pull || !errors.every(isWithheldField)) return null;
  const comments = (pull.comments?.nodes ?? []).flatMap((node): PullRequestConversationEntry[] => node ? [{
    id: node.id, kind: 'comment', author: node.author ? participant(node.author) : null, body: node.body, createdAt: node.createdAt, url: node.url || null, verdict: null, minimized: node.isMinimized === true,
  }] : []);
  // A pending review is the viewer's own unsubmitted draft, which isn't part of the conversation yet.
  const reviews = (pull.reviews?.nodes ?? []).flatMap((node): PullRequestConversationEntry[] => node && VERDICTS.has(node.state) ? [{
    id: node.id, kind: 'review', author: node.author ? participant(node.author) : null, body: node.body ?? '', createdAt: node.submittedAt || node.createdAt || '', url: node.url || null, verdict: node.state as PullRequestReviewVerdict, minimized: node.isMinimized === true,
  }] : []);
  return {
    entries: [...comments, ...reviews].sort((left, right) => (Date.parse(left.createdAt) || 0) - (Date.parse(right.createdAt) || 0)),
    truncated: pull.comments?.pageInfo.hasPreviousPage === true || pull.reviews?.pageInfo.hasPreviousPage === true,
    partial: errors.length > 0,
  };
}
