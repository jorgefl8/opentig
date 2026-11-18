import { useEffect, useState } from 'react';
import type { LineBlameCommit } from '@shared/line-blame';
import { opentig } from '@/lib/opentig-api';

export type LoadCommitAuthorAvatar = (repositoryId: string, oid: string) => Promise<string | null>;
/** Resolves once the picture can be drawn at once, or rejects when it can't be loaded. */
export type PreloadImage = (url: string) => Promise<void>;

function preloadImage(url: string): Promise<void> {
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  return image.decode();
}

/** Pictures already shown this session, per repository and author e-mail, so another commit by the same author shows its picture at once. */
const shownPictures = new Map<string, string>();
/** Reads under way per repository and commit, which every card asking about that commit shares. */
const pendingReads = new Map<string, Promise<string | null>>();

const authorKey = (repositoryId: string, commit: LineBlameCommit) => `${repositoryId}\0${commit.authorEmail.trim().toLowerCase()}`;
const commitKey = (repositoryId: string, commit: LineBlameCommit) => `${repositoryId}\0${commit.oid}`;

function authorPicture(repositoryId: string, commit: LineBlameCommit, load: LoadCommitAuthorAvatar, preload: PreloadImage): Promise<string | null> {
  const known = shownPictures.get(authorKey(repositoryId, commit));
  if (known) return Promise.resolve(known);
  const key = commitKey(repositoryId, commit);
  let read = pendingReads.get(key);
  if (!read) {
    read = load(repositoryId, commit.oid)
      .then(async (url) => {
        if (!url) return null;
        await preload(url);
        shownPictures.set(authorKey(repositoryId, commit), url);
        return url;
      })
      // The picture only decorates the card: any failure leaves its placeholder.
      .catch(() => null)
      // The server remembers GitHub's answers, so asking it again costs no GitHub request.
      .finally(() => pendingReads.delete(key));
    pendingReads.set(key, read);
  }
  return read;
}

/** Forgets what this session has shown, for tests. */
export function forgetCommitAuthorAvatars(): void {
  shownPictures.clear();
  pendingReads.clear();
}

/**
 * The picture of a blamed commit's author, asked for only while `enabled` (the card is open). Null
 * until it has loaded, and whenever there is none; an answer for a commit the card no longer shows
 * is dropped.
 */
export function useCommitAuthorAvatar({ enabled, repositoryId, commit, load = opentig.github.getCommitAuthorAvatar, preload = preloadImage }: {
  enabled: boolean;
  repositoryId: string;
  commit: LineBlameCommit | null;
  load?: LoadCommitAuthorAvatar;
  preload?: PreloadImage;
}): string | null {
  const asked = enabled && commit && !commit.uncommitted && commit.authorEmail ? commit : null;
  const key = asked ? commitKey(repositoryId, asked) : null;
  const [answer, setAnswer] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    if (!asked || !key) return;
    let active = true;
    void authorPicture(repositoryId, asked, load, preload).then((url) => { if (active && url) setAnswer({ key, url }); });
    return () => { active = false; };
    // `asked` is identified by `key`; the loaders are fixed for a card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!asked || !key) return null;
  return answer?.key === key ? answer.url : shownPictures.get(authorKey(repositoryId, asked)) ?? null;
}
