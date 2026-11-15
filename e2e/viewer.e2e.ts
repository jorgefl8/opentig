import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { openRepository } from './support/app';
import { expect, test, type GitRepository } from './support/fixtures';

interface SurfaceReport {
  /** What the surface showed on each painted frame, without repeats. */
  frames: string[];
  connected: boolean;
}

declare global {
  interface Window { __codeSurfaces: { reset(): void; report(): SurfaceReport[] } }
}

/**
 * Records every code surface the viewer creates and what each one shows on
 * every frame the browser paints: `plain` is code without its colors. A
 * surface is the element the library draws a file or a diff into, so two of
 * them for one document means it was mounted, and highlighted, twice.
 */
async function watchCodeSurfaces(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const surfaces: Array<{ host: Element; frames: string[] }> = [];
    const frameOf = (root: ShadowRoot): string => {
      const lines = [...root.querySelectorAll('[data-line]')].filter((line) => (line.textContent ?? '').trim());
      if (lines.length === 0) return 'empty';
      return root.querySelector('[data-line] span[style]') ? 'highlighted' : 'plain';
    };
    const attachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init: ShadowRootInit) {
      const root = attachShadow.call(this, init);
      if (this.localName === 'diffs-container') surfaces.push({ host: this, frames: [] });
      return root;
    };
    const sample = () => {
      for (const surface of surfaces) {
        if (!surface.host.isConnected || !surface.host.shadowRoot) continue;
        const frame = frameOf(surface.host.shadowRoot);
        if (surface.frames.at(-1) !== frame) surface.frames.push(frame);
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    window.__codeSurfaces = {
      reset() { surfaces.length = 0; },
      report: () => surfaces.map((surface) => ({ frames: surface.frames.filter((frame) => frame !== 'empty'), connected: surface.host.isConnected })),
    };
  });
  await page.reload();
}

/** Runs `action`, waits until the code it brings up has its colors, and returns the surfaces created for it. */
async function surfacesDuring(page: Page, action: () => Promise<void>): Promise<SurfaceReport[]> {
  await page.evaluate(() => window.__codeSurfaces.reset());
  await action();
  await expect.poll(async () => (await page.evaluate(() => window.__codeSurfaces.report())).some((surface) => surface.connected && surface.frames.at(-1) === 'highlighted')).toBe(true);
  // Two more frames, so a second mount or a late repaint would be in the report.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => window.__codeSurfaces.report());
}

/** TypeScript with something to color on every line. `changed` picks the lines a later version rewrites. */
function source(lines: number, name = 'step', changed: (index: number) => boolean = () => false): string {
  return Array.from({ length: lines }, (_, index) => `export function ${changed(index) ? 'changed' : name}${index}(value: number): string { return \`\${value + ${index}}\`; } // ${index}`).join('\n') + '\n';
}

async function write(repository: GitRepository, file: string, content: string): Promise<void> {
  await writeFile(path.join(repository.path, file), content);
}

const COLORED = [{ frames: ['highlighted'], connected: true }];

test('a long source file is drawn once, and with its colors when another file gave way to it', async ({ pairedPage: page, repository }) => {
  await repository.commit('src/long.ts', source(4000), 'Add a long module');
  await repository.commit('src/short.ts', source(12, 'short'), 'Add a short module');
  await watchCodeSurfaces(page);
  await openRepository(page, repository);
  await page.getByRole('navigation', { name: 'Repository views' }).getByRole('button', { name: 'Files' }).click();
  const tree = page.getByRole('tree', { name: 'Files' });
  await tree.getByRole('treeitem', { name: 'src' }).click();
  const open = (name: string, text: string) => surfacesDuring(page, async () => {
    await tree.getByRole('treeitem', { name }).click();
    await expect(page.getByRole('textbox', { name: `src/${name}` })).toContainText(text);
  });

  // The first file of a session also loads the editor and its grammar. It is still mounted once:
  // the editor takes over the file that is there instead of a second one being drawn.
  expect(await open('short.ts', 'short0')).toHaveLength(1);

  // From here on a file is drawn once and is never on screen without its colors.
  expect(await open('long.ts', 'step0')).toEqual(COLORED);
  expect(await open('short.ts', 'short0')).toEqual(COLORED);
  expect(await open('long.ts', 'step0')).toEqual(COLORED);

  // It is still the editor: typing lands in the file that was drawn.
  const editor = page.getByRole('textbox', { name: 'src/long.ts' });
  await editor.click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('// edited\n');
  await expect(page.getByRole('tablist', { name: 'Open files' }).getByRole('tab', { name: 'src/long.ts, unsaved changes' })).toBeVisible();
  await expect(editor).toContainText('// edited');
});

test('a diff seen before comes back with its colors: reopened, switched to split view, or unfolded again', async ({ pairedPage: page, repository }) => {
  await repository.commit('src/long.ts', source(1500), 'Add a long module');
  await repository.commit('src/other.ts', source(300, 'other'), 'Add another module');
  await repository.commit('src/long.ts', source(1500).replace('step700(', 'renamed700('), 'Rename a step');
  // Long enough to be highlighted by a worker, and short enough to be parsed without one.
  await write(repository, 'src/long.ts', source(1500, 'step', (index) => index < 600 && index % 5 === 0).replace('step700(', 'renamed700('));
  // Short enough to be highlighted where it is drawn.
  await write(repository, 'src/other.ts', source(300, 'other', (index) => index === 20));
  await watchCodeSurfaces(page);
  await openRepository(page, repository);
  const views = page.getByRole('navigation', { name: 'Repository views' });
  await views.getByRole('button', { name: /^Changes/ }).click();
  const code = page.getByRole('code');
  const openDiff = (file: string, text: string) => surfacesDuring(page, async () => {
    await page.getByRole('button', { name: `View changes for src/${file}` }).click();
    await expect(code.first()).toContainText(text);
  });

  // A first look may still be colored a moment after it appears. It is mounted once either way.
  expect(await openDiff('long.ts', 'changed40')).toHaveLength(1);
  expect(await openDiff('other.ts', 'changed20')).toHaveLength(1);

  // Everything below was highlighted above, so no frame shows it plain.
  expect(await openDiff('long.ts', 'changed40')).toEqual(COLORED);
  expect(await surfacesDuring(page, async () => {
    await page.getByRole('button', { name: 'Use split diff' }).click();
    await expect(code).toHaveCount(2);
  })).toEqual(COLORED);
  expect(await surfacesDuring(page, async () => {
    await page.getByRole('button', { name: 'Use unified diff' }).click();
    await expect(code).toHaveCount(1);
  })).toEqual(COLORED);
  expect(await openDiff('other.ts', 'changed20')).toEqual(COLORED);

  // A commit in History opens folded. Its file is colored the second time it is unfolded.
  await views.getByRole('button', { name: 'History' }).click();
  await page.getByRole('list', { name: 'Commit history' }).getByRole('button', { name: 'Rename a step', exact: true }).click();
  const file = page.getByRole('main').getByRole('button', { name: /^src\/\s*long\.ts$/ });
  const unfold = () => surfacesDuring(page, async () => {
    await file.click();
    await expect(file).toHaveAttribute('aria-expanded', 'true');
  });
  await expect(file).toHaveAttribute('aria-expanded', 'false');
  expect(await unfold()).toHaveLength(1);
  await file.click();
  await expect(page.getByRole('main').getByRole('code').filter({ hasText: 'renamed700' })).toBeHidden();
  expect(await unfold()).toEqual(COLORED);
});
