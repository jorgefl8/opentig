import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { SettingsStore } from './SettingsStore';

it('persists first-run completion without changing preferences or repositories', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'opentig-onboarding-'));
  try {
    const file = path.join(root, 'settings.json'), store = new SettingsStore(file);
    await store.load();
    expect(store.onboardingVersion).toBe(0);
    const preferences = store.preferences, recent = store.recentRepositories;
    await store.completeOnboarding();
    const reopened = new SettingsStore(file); await reopened.load();
    expect(reopened.onboardingVersion).toBe(1);
    expect(reopened.preferences).toEqual(preferences);
    expect(reopened.recentRepositories).toEqual(recent);
  } finally { await rm(root, { recursive: true, force: true }); }
});
it('migrates existing settings without forcing onboarding, including an empty repository list', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'opentig-onboarding-'));
  try {
    const file = path.join(root, 'settings.json'), store = new SettingsStore(file);
    await store.load();
    const legacy = JSON.parse(await readFile(file, 'utf8')); delete legacy.onboardingVersion;
    await writeFile(file, JSON.stringify(legacy));
    const migrated = new SettingsStore(file); await migrated.load();
    expect(migrated.onboardingVersion).toBe(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

