import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ReleaseDetails, ReleaseSummary } from '../../shared/contracts';
import { GhOperationError } from '../../shared/errors';

export const RELEASE_SUMMARY_FIELDS = 'tagName,name,isDraft,isPrerelease,isLatest,isImmutable,createdAt,publishedAt';
export const RELEASE_DETAIL_FIELDS = 'tagName,name,isDraft,isPrerelease,isImmutable,createdAt,publishedAt,databaseId,body,targetCommitish,url,assets';

/** GitHub's value for a date not reached yet, which `gh release list` returns for drafts. */
const UNSET_DATE = '0001-01-01T00:00:00Z';

const releaseSchema = z.object({
  tagName: z.string().min(1),
  name: z.string().nullish(),
  isDraft: z.boolean(),
  isPrerelease: z.boolean(),
  isImmutable: z.boolean().nullish(),
  createdAt: z.string().nullish(),
  publishedAt: z.string().nullish(),
});
const summarySchema = releaseSchema.extend({ isLatest: z.boolean().nullish() });
const detailsSchema = releaseSchema.extend({
  databaseId: z.number().int().positive(),
  body: z.string().nullish(),
  targetCommitish: z.string().nullish(),
  url: z.string().nullish(),
  assets: z.array(z.object({ name: z.string(), size: z.number().nonnegative().nullish() })).nullish(),
});

function invalid(operation: string): GhOperationError {
  return new GhOperationError({ code: 'GH_INVALID_OUTPUT', operation, message: 'GitHub CLI returned an unexpected response.' });
}

function parseJson(raw: string, operation: string): unknown {
  try { return JSON.parse(raw); } catch { throw invalid(operation); }
}

function summaryOf(release: z.infer<typeof releaseSchema>, isLatest: boolean): ReleaseSummary {
  return {
    tagName: release.tagName,
    name: release.name || release.tagName,
    isDraft: release.isDraft,
    isPrerelease: release.isPrerelease,
    isLatest,
    isImmutable: release.isImmutable === true,
    createdAt: release.createdAt ?? '',
    publishedAt: release.publishedAt && release.publishedAt !== UNSET_DATE ? release.publishedAt : null,
  };
}

export function parseReleaseList(raw: string): ReleaseSummary[] {
  const parsed = z.array(summarySchema).safeParse(parseJson(raw, 'gh-release-list'));
  if (!parsed.success) throw invalid('gh-release-list');
  return parsed.data.map((release) => summaryOf(release, release.isLatest === true));
}

export function releaseBodyHash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

export function parseReleaseDetails(raw: string, facts: { isLatest: boolean; tagExists: boolean; viewerCanWrite: boolean }): ReleaseDetails {
  const parsed = detailsSchema.safeParse(parseJson(raw, 'gh-release-view'));
  if (!parsed.success) throw invalid('gh-release-view');
  const release = parsed.data;
  const body = release.body ?? '';
  return {
    ...summaryOf(release, facts.isLatest),
    databaseId: release.databaseId,
    body,
    bodyHash: releaseBodyHash(body),
    targetCommitish: release.targetCommitish ?? '',
    url: release.url ?? '',
    assets: (release.assets ?? []).map((asset) => ({ name: asset.name, size: asset.size ?? 0 })),
    tagExists: facts.tagExists,
    viewerCanWrite: facts.viewerCanWrite,
  };
}
