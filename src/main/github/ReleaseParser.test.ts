import { describe, expect, it } from 'vitest';
import { parseReleaseDetails, parseReleaseList, releaseBodyHash } from './ReleaseParser';

const facts = { isLatest: false, tagExists: true, viewerCanWrite: true };
const summary = { tagName: 'v1.0.0', name: 'One', isDraft: false, isPrerelease: false, isLatest: true, isImmutable: false, createdAt: '2026-01-01T00:00:00Z', publishedAt: '2026-01-02T00:00:00Z' };
const details = { tagName: 'v1.0.0', name: 'One', isDraft: true, isPrerelease: false, isImmutable: false, createdAt: '2026-01-01T00:00:00Z', publishedAt: null, databaseId: 42, body: '<!-- opentig:release-notes:start -->\nNotes', targetCommitish: 'a'.repeat(40), url: 'https://github.com/sample/demo/releases/tag/untagged-1', assets: [{ name: 'app.exe', size: 2048, apiUrl: 'x', state: 'uploaded' }] };

describe('parseReleaseList', () => {
  it('reads the fields it asked for', () => {
    expect(parseReleaseList(JSON.stringify([summary]))).toEqual([summary]);
  });

  it('turns the placeholder date of a draft into no date, as gh release list returns it', () => {
    expect(parseReleaseList(JSON.stringify([{ ...summary, isDraft: true, publishedAt: '0001-01-01T00:00:00Z' }]))[0]?.publishedAt).toBeNull();
  });

  it('falls back to the tag for a release without a name', () => {
    expect(parseReleaseList(JSON.stringify([{ ...summary, name: '' }]))[0]?.name).toBe('v1.0.0');
  });

  it.each(['nope', '{}', JSON.stringify([{ name: 'No tag' }])])('rejects %s as an unexpected response', (raw) => {
    expect(() => parseReleaseList(raw)).toThrow('GitHub CLI returned an unexpected response.');
  });
});

describe('parseReleaseDetails', () => {
  it('keeps the notes raw, and hashes exactly that text', () => {
    const release = parseReleaseDetails(JSON.stringify(details), facts);
    expect(release.body).toBe(details.body);
    expect(release.bodyHash).toBe(releaseBodyHash(details.body));
    expect(release.bodyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(release).toMatchObject({ databaseId: 42, publishedAt: null, assets: [{ name: 'app.exe', size: 2048 }], tagExists: true, viewerCanWrite: true, isLatest: false });
  });

  it('accepts the placeholder date too', () => {
    expect(parseReleaseDetails(JSON.stringify({ ...details, publishedAt: '0001-01-01T00:00:00Z' }), facts).publishedAt).toBeNull();
  });

  it('treats different notes as different', () => {
    expect(releaseBodyHash('a')).not.toBe(releaseBodyHash('a\n'));
  });

  it('rejects a release without an id', () => {
    expect(() => parseReleaseDetails(JSON.stringify({ ...details, databaseId: undefined }), facts)).toThrow('GitHub CLI returned an unexpected response.');
  });
});
