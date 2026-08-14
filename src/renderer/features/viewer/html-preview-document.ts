const STYLE_MARKER = 'data-justgit-preview-scrollbar';

export function buildHtmlPreviewDocument(content: string, dark: boolean): string {
  const foreground = dark ? '255 255 255' : '0 0 0';
  const background = dark ? 'oklch(0.13 0 0)' : 'oklch(0.985 0 0)';
  const style = [
    `<style ${STYLE_MARKER}>`,
    'html {',
    `  color-scheme: ${dark ? 'dark' : 'light'} !important;`,
    `  background-color: ${background} !important;`,
    '}',
    'html, body, * {',
    '  scrollbar-width: thin !important;',
    `  scrollbar-color: rgb(${foreground} / 18%) transparent !important;`,
    '}',
    'html::-webkit-scrollbar, body::-webkit-scrollbar, *::-webkit-scrollbar { width: 10px !important; height: 10px !important; }',
    'html::-webkit-scrollbar-track, body::-webkit-scrollbar-track, *::-webkit-scrollbar-track,',
    'html::-webkit-scrollbar-corner, body::-webkit-scrollbar-corner, *::-webkit-scrollbar-corner { background: transparent !important; }',
    'html::-webkit-scrollbar-thumb, body::-webkit-scrollbar-thumb, *::-webkit-scrollbar-thumb {',
    `  background-color: rgb(${foreground} / 18%) !important;`,
    '  background-clip: content-box !important;',
    '  border: 3px solid transparent !important;',
    '  border-radius: 999px !important;',
    '}',
    `html::-webkit-scrollbar-thumb:hover, body::-webkit-scrollbar-thumb:hover, *::-webkit-scrollbar-thumb:hover { background-color: rgb(${foreground} / 28%) !important; }`,
    'html::-webkit-scrollbar-button, body::-webkit-scrollbar-button, *::-webkit-scrollbar-button { display: none !important; width: 0 !important; height: 0 !important; }',
    '</style>',
  ].join('\n');

  const headClose = content.search(/<\/head\s*>/i);
  if (headClose >= 0) return `${content.slice(0, headClose)}${style}\n${content.slice(headClose)}`;

  const headOpen = /<head(?:\s[^>]*)?>/i.exec(content);
  if (headOpen?.index !== undefined) {
    const insertion = headOpen.index + headOpen[0].length;
    return `${content.slice(0, insertion)}\n${style}${content.slice(insertion)}`;
  }

  const htmlOpen = /<html(?:\s[^>]*)?>/i.exec(content);
  if (htmlOpen?.index !== undefined) {
    const insertion = htmlOpen.index + htmlOpen[0].length;
    return `${content.slice(0, insertion)}\n<head>${style}</head>${content.slice(insertion)}`;
  }

  return `${style}\n${content}`;
}
