// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { summarizeUpdateReleaseNotes } from './update-release-notes';

describe('update release-note previews', () => {
  it('reads GitHub feed HTML as text while retaining contributor and PR attribution', () => {
    expect(summarizeUpdateReleaseNotes('<h2>Changes</h2><ul><li>Fix <code>updates</code> by <a href="https://github.com/author">@author</a> in #42</li></ul>'))
      .toEqual({ items: ['Fix updates by @author in #42'], omitted: 0 });
  });

  it('summarizes Markdown notes with a correct count for the full release link', () => {
    const notes = Array.from({ length: 11 }, (_, index) => `- Change **${index}** by [@author](https://github.com/author)`).join('\n');
    const summary = summarizeUpdateReleaseNotes(notes);
    expect(summary.items).toHaveLength(8);
    expect(summary.items[0]).toBe('Change 0 by @author');
    expect(summary.omitted).toBe(3);
  });

  it('ignores executable markup, handles missing notes, and preserves prose', () => {
    expect(summarizeUpdateReleaseNotes('<script>window.compromised=true</script><ul><li><img src=x onerror=alert(1)>Safe change</li></ul>'))
      .toEqual({ items: ['Safe change'], omitted: 0 });
    expect(summarizeUpdateReleaseNotes(null)).toEqual({ items: [], omitted: 0 });
    expect(summarizeUpdateReleaseNotes('A small maintenance release.')).toEqual({ items: ['A small maintenance release.'], omitted: 0 });
  });
});
