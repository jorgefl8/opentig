import { expect, type Locator, type Page } from '@playwright/test';
import type { GitRepository } from './fixtures';

/** Adds a repository through the "Open a folder" dialog, as a user would. */
export async function openRepository(page: Page, repository: GitRepository): Promise<void> {
  await page.getByRole('button', { name: /Open a folder/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Open a repository' });
  await dialog.getByRole('button', { name: 'Enter a folder path' }).click();
  const folderPath = dialog.getByRole('textbox', { name: 'Folder path' });
  await folderPath.fill(repository.path);
  await folderPath.press('Enter');
  await expect(dialog.getByText('This folder is a Git repository')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add repository' }).click();
  // Shortcuts are ignored while any dialog is open, so wait for it to close.
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Select project or repository' })).toContainText(repository.name);
}

/**
 * The color swatches drawn before color values. They are decorative and
 * hidden from assistive technology, so only their class finds them.
 */
export function colorSwatches(page: Page): Locator {
  return page.locator('.color-swatch > span');
}

/** The hover preview of a color, shown in a tooltip with its value. */
export function colorPreview(page: Page, value: string): Locator {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByRole('code').filter({ hasText: new RegExp(`^${escaped}$`) });
}

/** Swatches let clicks through to the code, so the pointer is moved over them instead. */
export async function hoverCenter(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('The target is not on screen.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}
