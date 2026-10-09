import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseSync, Visitor, type JSXMemberExpression, type MemberExpression, type Node } from 'oxc-parser';

export function analyzeSource(source: string, filename = 'source.ts') {
  const parsed = parseSync(filename, source);
  if (parsed.errors.length) throw new SyntaxError(`Cannot analyze ${filename}: ${parsed.errors.map((error) => error.message).join('; ')}`);
  const tree = parsed.program;
  const imports: string[] = [];
  const accesses: string[] = [];
  const names = new Map<string, string>();
  function accessPath(node: Node): string | undefined {
    if (node.type === 'Identifier' || node.type === 'JSXIdentifier') return names.get(node.name) ?? node.name;
    if (node.type === 'MemberExpression' || node.type === 'JSXMemberExpression') {
      const parent = accessPath(node.object);
      const property = node.type === 'JSXMemberExpression' ? node.property.name
        : node.computed ? node.property.type === 'Literal' && typeof node.property.value === 'string' ? node.property.value : undefined
          : node.property.type === 'Identifier' ? node.property.name : undefined;
      return parent && property ? `${parent}.${property}` : undefined;
    }
  }
  function collectAccess(node: MemberExpression | JSXMemberExpression) {
    const name = accessPath(node);
    if (name) accesses.push(name);
  }
  // Resolve named import aliases before examining member access.
  for (const node of tree.body) {
    if (node.type !== 'ImportDeclaration') continue;
    for (const binding of node.specifiers) {
      if (binding.type === 'ImportSpecifier') names.set(binding.local.name, binding.imported.type === 'Identifier' ? binding.imported.name : binding.imported.value);
    }
  }
  new Visitor({
    ImportDeclaration(node) { imports.push(node.source.value); },
    ExportAllDeclaration(node) { imports.push(node.source.value); },
    ExportNamedDeclaration(node) { if (node.source) imports.push(node.source.value); },
    TSImportEqualsDeclaration(node) {
      if (node.moduleReference.type === 'TSExternalModuleReference') imports.push(node.moduleReference.expression.value);
    },
    ImportExpression(node) {
      if (node.source.type === 'Literal' && typeof node.source.value === 'string') imports.push(node.source.value);
    },
    CallExpression(node) {
      if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return;
      const argument = node.arguments[0];
      if (argument?.type === 'Literal' && typeof argument.value === 'string') imports.push(argument.value);
    },
    MemberExpression: collectAccess,
    JSXMemberExpression: collectAccess,
  }).visit(tree);
  return { imports, accesses };
}

export async function sourceFiles(directory: string): Promise<Array<{ file: string; imports: string[]; accesses: string[] }>> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [{ file, ...analyzeSource(await readFile(file, 'utf8'), file) }];
  }))).flat();
}
