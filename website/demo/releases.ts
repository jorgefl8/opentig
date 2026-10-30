import type { ReleaseDetails } from '../../src/shared/contracts';
import { sampleDate } from './model.ts';

const notes = (headline: string, items: string[]) => `## ${headline}\n\n${items.map((item) => `- ${item}`).join('\n')}\n`;
const assets = [
  { name: 'launchpad-setup-0.4.0.exe', size: 96_468_992 },
  { name: 'launchpad-setup-0.4.0.exe.blockmap', size: 102_400 },
  { name: 'latest.yml', size: 412 },
];
function release(tagName: string, name: string, overrides: Partial<ReleaseDetails>, body: string): ReleaseDetails {
  return {
    tagName, name, isDraft: false, isPrerelease: false, isLatest: false, isImmutable: false, createdAt: sampleDate, publishedAt: sampleDate,
    databaseId: tagName.length * 1000 + name.length, body, bodyHash: 'a'.repeat(64), targetCommitish: 'b'.repeat(40), url: '', assets: [], tagExists: true, viewerCanWrite: true, ...overrides,
  };
}
const samples = [
  release('v0.5.0', 'Launchpad v0.5.0', { isDraft: true, publishedAt: null, tagExists: false }, notes("What's changed", ['Group tasks by owner', 'Keep filters in the URL'])),
  release('v0.4.0', 'Launchpad v0.4.0', { isDraft: true, publishedAt: null, assets }, notes("What's changed", ['Hide completed tasks from search results', 'Refine the release board on small screens'])),
  release('v0.3.0', 'Launchpad v0.3.0', { isLatest: true, assets }, notes("What's changed", ['Document the local test command', 'Filter tasks by status'])),
  release('v0.3.0-rc.1', 'Launchpad v0.3.0 RC 1', { isPrerelease: true }, notes('Release candidate', ['Filter tasks by status'])),
];
export const demoReleases = {
  list() {
    return samples.map(({ tagName, name, isDraft, isPrerelease, isLatest, isImmutable, createdAt, publishedAt }) => ({ tagName, name, isDraft, isPrerelease, isLatest, isImmutable, createdAt, publishedAt }));
  },
  get(tagName: string) {
    const found = samples.find((sample) => sample.tagName === tagName);
    if (!found) throw new Error('Choose a release from the sample repository.');
    return structuredClone(found);
  },
};
