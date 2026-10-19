import { expect, it } from 'vitest';
import type { RemoteAccessProblem } from '@shared/repository-access';
import { remoteAccessActionLabel, remoteAccessCopy } from './remote-access';

const problem = (overrides: Partial<RemoteAccessProblem> = {}): RemoteAccessProblem => ({
  repository: 'idener/credit-platform-deployments', transport: 'https', login: 'jorgefl8', candidates: [], sso: false, ...overrides,
});

it('names the account that failed and offers one that has access', () => {
  const copy = remoteAccessCopy(problem({ candidates: ['jorge-idener'] }));
  expect(copy).toEqual({ summary: '@jorgefl8 can’t access idener/credit-platform-deployments.', detail: '@jorge-idener can access it.', action: { kind: 'use-account', login: 'jorge-idener' } });
  expect(remoteAccessActionLabel(copy.action)).toBe('Use @jorge-idener');
});

it('points to account settings when no connected account has access', () => {
  expect(remoteAccessCopy(problem())).toMatchObject({ detail: expect.stringContaining('None of your connected accounts'), action: { kind: 'settings' } });
  expect(remoteAccessCopy(problem({ login: null })).summary).toBe('Git’s own credentials can’t access idener/credit-platform-deployments.');
});

it('blames the SSH key for SSH remotes instead of suggesting another account', () => {
  const copy = remoteAccessCopy(problem({ transport: 'ssh', login: null }));
  expect(copy.summary).toBe('Your SSH key can’t access idener/credit-platform-deployments.');
  expect(copy.action).toEqual({ kind: 'settings' });
});

it('explains organisation single sign-on and links to its authorization page', () => {
  const copy = remoteAccessCopy(problem({ sso: true, candidates: ['other'] }));
  expect(copy.summary).toBe('idener requires single sign-on for @jorgefl8.');
  expect(copy.action).toEqual({ kind: 'sso', url: 'https://github.com/orgs/idener/sso' });
  expect(remoteAccessActionLabel(copy.action)).toBe('Authorize on GitHub');
});

it('asks to push again after the repository switched to an account with access', () => {
  const copy = remoteAccessCopy(problem({ switchedTo: 'jorge-idener' }));
  expect(copy.summary).toBe('This repository now uses @jorge-idener, which can access idener/credit-platform-deployments.');
  expect(remoteAccessActionLabel(copy.action)).toBe('Push with @jorge-idener');
});
