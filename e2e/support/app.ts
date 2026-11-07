import { expect, type Page } from '@playwright/test';
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
