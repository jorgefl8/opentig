import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { openRepository } from './support/app';
import { expect, test, type GitRepository } from './support/fixtures';

/** How many angles of the turn are measured, evenly spaced. */
const ANGLES = 12;
/** The spinner takes this long to turn once. */
const TURN_MS = 1000;

interface Circle { x: number; y: number; radius: number }

/**
 * Makes fetching from `origin` wait until the returned function is called, so
 * the spinner a refresh shows stays on screen. Git runs this in place of
 * `git upload-pack`; it also stops waiting once the test's folder is gone.
 */
async function holdFetches(repository: GitRepository): Promise<() => Promise<void>> {
  const root = path.dirname(repository.path);
  const gate = path.join(root, 'answer-fetches');
  const uploadPack = path.join(root, 'held-upload-pack');
  await writeFile(uploadPack, `#!/bin/sh\nwhile [ ! -e '${gate}' ] && [ -d '${root}' ]; do sleep 0.05; done\nexec git upload-pack "$@"\n`, { mode: 0o755 });
  await repository.git('config', 'remote.origin.uploadpack', uploadPack);
  return () => writeFile(gate, '');
}

/**
 * Screenshots the spinner with its arc paused at each angle and fits circles to
 * what was drawn, in device pixels:
 *  - `perAngle`: the ring as drawn at each angle, faint track and arc together;
 *  - `track`: the faint ring alone, from the darkest each pixel gets over the turn;
 *  - `swept`: the ring the arc sweeps, from the brightest each pixel gets.
 */
async function measureTurn(page: Page, spinner: Locator): Promise<{ perAngle: Circle[]; track: Circle; swept: Circle }> {
  const box = await spinner.boundingBox();
  if (!box) throw new Error('The spinner is not on screen.');
  const clip = { x: Math.floor(box.x) - 3, y: Math.floor(box.y) - 3, width: Math.ceil(box.width) + 6, height: Math.ceil(box.height) + 6 };
  const frames: string[] = [];
  for (let step = 0; step < ANGLES; step++) {
    await spinner.locator('g').evaluate((group, time) => {
      const [turn] = group.getAnimations();
      if (!turn) throw new Error('The spinner arc is not animated.');
      turn.pause();
      turn.currentTime = time;
    }, (step * TURN_MS) / ANGLES);
    frames.push((await page.screenshot({ clip })).toString('base64'));
  }

  // A blank page of the same browser reads the pixels back; nothing here depends on the app.
  const reader = await page.context().newPage();
  try {
    return await reader.evaluate(async (pngs) => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      const images: Float64Array[] = [];
      let width = 0;
      for (const png of pngs) {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        width = canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, width, canvas.height);
        // How far each pixel is from the background, taken from the corner the ring never reaches.
        const ink = new Float64Array(width * canvas.height);
        for (let pixel = 0; pixel < ink.length; pixel++) {
          ink[pixel] = Math.abs(data[pixel * 4]! - data[0]!) + Math.abs(data[pixel * 4 + 1]! - data[1]!) + Math.abs(data[pixel * 4 + 2]! - data[2]!);
        }
        images.push(ink);
      }

      /** Least-squares circle through the drawn pixels, each weighted by how much ink it holds. */
      const fit = (ink: Float64Array) => {
        let total = 0, sumX = 0, sumY = 0;
        for (let pixel = 0; pixel < ink.length; pixel++) {
          total += ink[pixel]!; sumX += ink[pixel]! * ((pixel % width) + .5); sumY += ink[pixel]! * (Math.floor(pixel / width) + .5);
        }
        const meanX = sumX / total, meanY = sumY / total;
        let uu = 0, uv = 0, vv = 0, uuu = 0, vvv = 0, uvv = 0, vuu = 0;
        for (let pixel = 0; pixel < ink.length; pixel++) {
          const weight = ink[pixel]!;
          const u = (pixel % width) + .5 - meanX, v = Math.floor(pixel / width) + .5 - meanY;
          uu += weight * u * u; uv += weight * u * v; vv += weight * v * v;
          uuu += weight * u * u * u; vvv += weight * v * v * v; uvv += weight * u * v * v; vuu += weight * v * u * u;
        }
        const determinant = uu * vv - uv * uv, a = (uuu + uvv) / 2, b = (vvv + vuu) / 2;
        const x = (a * vv - b * uv) / determinant, y = (b * uu - a * uv) / determinant;
        return { x: meanX + x, y: meanY + y, radius: Math.sqrt(x * x + y * y + (uu + vv) / total) };
      };
      const across = (pick: (...values: number[]) => number) => images[0]!.map((_, pixel) => pick(...images.map((ink) => ink[pixel]!)));
      return { perAngle: images.map(fit), track: fit(across(Math.min)), swept: fit(across(Math.max)) };
    }, frames);
  } finally {
    await reader.close();
  }
}

const distance = (a: Circle, b: Circle) => Math.hypot(a.x - b.x, a.y - b.y);

// 1.25 is the display scale of the laptop the spinner was seen circling on.
for (const scale of [1, 1.25]) {
  test.describe(`at a display scale of ${scale}`, () => {
    test.use({ deviceScaleFactor: scale });

    test('the Refresh spinner turns on its own center', async ({ pairedPage: page, repository }, testInfo) => {
      await repository.addRemote();
      await openRepository(page, repository);
      const release = await holdFetches(repository);
      const refresh = page.getByRole('banner').getByRole('button', { name: 'Refresh' });
      await refresh.click();
      // The pointer would otherwise leave a tooltip beside the icon being measured.
      await page.mouse.move(0, 0);
      const spinner = refresh.locator('[data-slot="spinner"]');
      await expect(spinner).toBeVisible();
      await expect(refresh).toBeDisabled();

      const { perAngle, track, swept } = await measureTurn(page, spinner);
      const center = { x: perAngle.reduce((sum, circle) => sum + circle.x, 0) / ANGLES, y: perAngle.reduce((sum, circle) => sum + circle.y, 0) / ANGLES, radius: 0 };
      const orbit = Math.max(...perAngle.map((circle) => distance(circle, center)));
      const offCenter = distance(swept, track);
      testInfo.annotations.push({ type: 'spinner geometry', description: `scale ${scale}: ring radius ${track.radius.toFixed(2)} device px, center moves at most ${orbit.toFixed(3)} device px over ${ANGLES} angles, the arc turns ${offCenter.toFixed(3)} device px off the ring's center` });

      // A real ring was measured: the 16px icon draws a ring of 6 CSS px radius.
      expect(track.radius).toBeGreaterThan(5 * scale);
      expect(track.radius).toBeLessThan(7 * scale);
      // The ring stays where it is while the arc turns, and the arc turns about the ring's center.
      expect(orbit).toBeLessThan(0.3);
      expect(offCenter).toBeLessThan(0.3);

      // Once the refresh is answered the button offers Refresh again, the same size as before.
      const busySize = await refresh.boundingBox();
      await release();
      await expect(spinner).toBeHidden();
      await expect(refresh).toBeEnabled();
      expect(await refresh.boundingBox()).toEqual(busySize);
    });
  });
}
