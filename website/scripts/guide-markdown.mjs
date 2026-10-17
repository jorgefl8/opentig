import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { documentationRoutes } from '../docs.config.mjs';

const repositoryBase = 'https://github.com/jorgefl8/opentig/blob/main/';
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

// Resolve against the original file, including guides outside docs/.
// GitHub keeps the original Markdown; only the site's rendered links change.
export function guideMarkdown({ source } = {}) {
  return (tree, file) => {
    const sourcePath = source ?? (file?.path
      ? relative(repositoryRoot, resolve(file.path)).split(sep).join('/')
      : 'docs/');
    const base = new URL(sourcePath, repositoryBase);
    const localLink = value => {
      if (/^(?:#|mailto:|tel:|data:)/i.test(value)) return value;
      const url = new URL(value, base);
      if (!url.href.startsWith(repositoryBase)) return value;
      const destination = documentationRoutes.get(decodeURIComponent(url.pathname.slice(new URL(repositoryBase).pathname.length)));
      return destination ? `${destination}${url.search}${url.hash}` : url.href;
    };
    tree.children = tree.children.filter(node => {
      if (node.type === 'heading' && node.depth === 1) return false;
      // Remove the GitHub back link and its separator, keeping companion links.
      if (node.type === 'paragraph' && node.children?.[0]?.type === 'link' &&
        localLink(node.children[0].url) === '/docs/' &&
        node.children[0].children?.some(child => child.type === 'text' && child.value.includes('←'))) {
        node.children.shift();
        if (node.children[0]?.type === 'text') {
          node.children[0].value = node.children[0].value.replace(/^\s*·?\s*/, '');
          if (!node.children[0].value) node.children.shift();
        }
        return node.children.length > 0;
      }
      return true;
    });
    function visit(node) {
      if (node.type === 'link' || node.type === 'definition') node.url = localLink(node.url);
      for (const child of node.children ?? []) visit(child);
    }
    visit(tree);
  };
}

// Preserve table semantics while making wide tables keyboard-scrollable.
export function guideTables() {
  return tree => {
    function visit(node) {
      for (const [index, child] of (node.children ?? []).entries()) {
        visit(child);
        if (child.type === 'element' && child.tagName === 'table') {
          node.children[index] = {
            type: 'element', tagName: 'div',
            properties: { className: ['docs-table-scroll'], tabIndex: 0, role: 'region', ariaLabel: 'Documentation table' },
            children: [child],
          };
        }
      }
    }
    visit(tree);
  };
}
