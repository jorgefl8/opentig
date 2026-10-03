import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

export function analyzeSource(source: string, filename = 'source.ts') {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports: string[] = [];
  const accesses: string[] = [];
  const names = new Map<string, string>();
  function accessPath(node: ts.Node): string | undefined {
    if (ts.isIdentifier(node)) return names.get(node.text) ?? node.text;
    if (ts.isPropertyAccessExpression(node)) {
      const parent = accessPath(node.expression);
      return parent ? `${parent}.${node.name.text}` : undefined;
    }
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
      const parent = accessPath(node.expression);
      return parent ? `${parent}.${node.argumentExpression.text}` : undefined;
    }
  }
  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
      imports.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) imports.push(argument.text);
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = accessPath(node);
      if (name) accesses.push(name);
    }
    ts.forEachChild(node, visit);
  }
  // Resolve named import aliases before examining member access.
  for (const node of tree.statements) {
    if (!ts.isImportDeclaration(node) || !node.importClause?.namedBindings || !ts.isNamedImports(node.importClause.namedBindings)) continue;
    for (const binding of node.importClause.namedBindings.elements) {
      names.set(binding.name.text, binding.propertyName?.text ?? binding.name.text);
    }
  }
  visit(tree);
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
