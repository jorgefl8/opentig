import type { FileChange } from '../../../shared/git-types';

export interface ChangeTreeEntry {
  name: string;
  path: string;
  type: 'directory' | 'file';
  change: FileChange | null;
  children: ChangeTreeEntry[];
}

export type ChangeVirtualRow =
  | { kind: 'directory'; node: ChangeTreeEntry; depth: number }
  | { kind: 'file'; change: FileChange; depth: number };

interface MutableChangeTreeEntry extends Omit<ChangeTreeEntry, 'children'> { children: Map<string, MutableChangeTreeEntry> }

export function flattenChangeTree(nodes: ChangeTreeEntry[], collapsedPaths: ReadonlySet<string>, depth = 0): ChangeVirtualRow[] {
  const rows: ChangeVirtualRow[] = [];
  for (const node of nodes) {
    if (node.type === 'file' && node.change) {
      rows.push({ kind: 'file', change: node.change, depth });
      continue;
    }
    rows.push({ kind: 'directory', node, depth });
    if (!collapsedPaths.has(node.path)) rows.push(...flattenChangeTree(node.children, collapsedPaths, depth + 1));
  }
  return rows;
}

export function buildChangeTree(changes: FileChange[]): ChangeTreeEntry[] {
  const root = new Map<string, MutableChangeTreeEntry>();
  for (const change of changes) {
    const parts = change.path.split('/').filter(Boolean);
    let level = root;
    let accumulated = '';
    parts.forEach((part, index) => {
      accumulated = accumulated ? `${accumulated}/${part}` : part;
      const isFile = index === parts.length - 1;
      let node = level.get(part);
      if (!node) {
        node = { name: part, path: accumulated, type: isFile ? 'file' : 'directory', change: isFile ? change : null, children: new Map() };
        level.set(part, node);
      } else if (isFile) {
        node.change = change;
        node.type = 'file';
      }
      level = node.children;
    });
  }
  const serialize = (nodes: Map<string, MutableChangeTreeEntry>): ChangeTreeEntry[] => [...nodes.values()]
    .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1)
    .map((node) => ({ name: node.name, path: node.path, type: node.type, change: node.change, children: serialize(node.children) }));
  return serialize(root);
}

export function collectChangePaths(node: ChangeTreeEntry): string[] {
  if (node.type === 'file') return node.change ? [node.change.path] : [];
  return node.children.flatMap(collectChangePaths);
}
