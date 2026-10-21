import { homedir } from 'node:os';
import { GitOperationError } from '../../shared/errors';
import { gitIdentityInputSchema } from '../../shared/onboarding';
import type { GitProcess } from './GitProcess';

/**
 * First-run setup only: writes user.name/email to the global Git config when
 * neither exists, so an identity configured elsewhere is never replaced.
 */
export async function setGlobalGitIdentity(git: GitProcess, input: unknown): Promise<void> {
  const parsed = gitIdentityInputSchema.safeParse(input);
  if (!parsed.success) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'git-identity-set', message: 'Enter a name and a valid email address.' });
  const cwd = homedir();
  let existing = '';
  try {
    existing = (await git.run(cwd, ['config', '--global', '--get-regexp', '^user\\.(name|email)$'], { operation: 'git-identity-read', readOnly: true })).stdout.toString('utf8');
  } catch (error) {
    // Exit code 1 means neither key is set.
    if (!(error instanceof GitOperationError && error.detail.exitCode === 1)) throw error;
  }
  if (existing.trim()) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'git-identity-set', message: 'A global Git identity already exists. Change it from a terminal with git config --global.' });
  await git.runWrite(cwd, ['config', '--global', '--', 'user.name', parsed.data.name], { operation: 'git-identity-set' });
  await git.runWrite(cwd, ['config', '--global', '--', 'user.email', parsed.data.email], { operation: 'git-identity-set' });
}
