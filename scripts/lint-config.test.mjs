import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../node_modules/oxlint/bin/oxlint', import.meta.url));

async function lintFixture(files) {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentig-lint-'));
  try {
    await cp(new URL('../.oxlintrc.json', import.meta.url), path.join(directory, '.oxlintrc.json'));
    for (const [filename, source] of Object.entries(files)) {
      const file = path.join(directory, filename);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, source);
    }
    let stdout;
    try {
      ({ stdout } = await execute(process.execPath, [cli, '.', '--format', 'json'], { cwd: directory, timeout: 30_000 }));
    } catch (error) {
      if (error.code !== 1 || !error.stdout) throw error;
      stdout = error.stdout;
    }
    return JSON.parse(stdout).diagnostics;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

it('retains TypeScript, hook ordering, and effect dependency checks in renderer files', async () => {
  const diagnostics = await lintFixture({
    'src/renderer/Probe.tsx': `
      import { useEffect, useState } from 'react';
      export function Probe({ enabled, value }: { enabled: boolean; value: any }) {
        if (enabled) useState(0);
        useEffect(() => { console.log(value); }, []);
        return <span>{value}</span>;
      }
    `,
  });
  expect(diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'typescript(no-explicit-any)', severity: 'error' }),
    expect.objectContaining({ code: 'react-hooks(rules-of-hooks)', severity: 'error' }),
    expect.objectContaining({ code: 'react-hooks(exhaustive-deps)', severity: 'warning' }),
  ]));
});

it('allows the appropriate JavaScript globals while catching undefined names', async () => {
  const diagnostics = await lintFixture({
    'scripts/probe.mjs': 'console.log(process.platform, missingNodeName);',
    'public/probe.js': 'window.localStorage.setItem("theme", document.documentElement.className); missingBrowserName();',
  });
  expect(diagnostics).toHaveLength(2);
  expect(diagnostics.every((diagnostic) => diagnostic.code === 'eslint(no-undef)' && diagnostic.severity === 'error')).toBe(true);
  expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual(expect.arrayContaining([
    "'missingNodeName' is not defined.", "'missingBrowserName' is not defined.",
  ]));
});
