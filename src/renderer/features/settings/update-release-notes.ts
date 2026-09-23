import { marked } from 'marked';

/** Parse feed HTML or Markdown in an inert document; render only text in React. */
export function summarizeUpdateReleaseNotes(source: string | null | undefined): { items: string[]; omitted: number } {
  if (!source?.trim()) return { items: [], omitted: 0 };
  const html = marked.parse(source.slice(0, 64_000), { async: false });
  const document = new DOMParser().parseFromString(html, 'text/html');
  document.querySelectorAll('script, style, template, iframe, object, embed').forEach((element) => element.remove());
  const listItems = [...document.querySelectorAll('li')].filter((element) => !element.parentElement?.closest('li'));
  const entries = listItems.length ? listItems : [...document.querySelectorAll('p')];
  const items = (entries.length ? entries.map((element) => element.textContent ?? '') : [document.body.textContent ?? ''])
    .map((text) => text.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return { items: items.slice(0, 8), omitted: Math.max(0, items.length - 8) };
}
