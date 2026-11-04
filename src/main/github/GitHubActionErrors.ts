import type { CliRunResult } from '../ai/CliProcessRunner';
import { GhOperationError } from '../../shared/errors';

function firstLine(value: string): string {
  return (value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '').slice(0, 300);
}

/**
 * The failure of a mutation, from stderr alone and anchored to how `gh` reports
 * it. PR titles and check names appear in these messages, so a PR called
 * "Fix authentication" or numbered #401 must not read as an account problem.
 */
export function classifyActionFailure(result: Pick<CliRunResult, 'stderr' | 'exitCode'>, operation: string): GhOperationError {
  const stderr = result.stderr;
  const exitCode = result.exitCode;
  if (/API rate limit exceeded|secondary rate limit|abuse detection|\(HTTP 429\)\s*$/im.test(stderr)) {
    return new GhOperationError({ code: 'GH_RATE_LIMITED', operation, message: 'GitHub rejected the request because of a rate limit. Try again later.', exitCode, retryable: true });
  }
  if (/\(HTTP 401\)\s*$|^(?:gh: )?Bad credentials\b|\bgh auth login\b/im.test(stderr)) {
    return new GhOperationError({ code: 'GH_AUTH_REQUIRED', operation, message: 'Sign in with gh auth login to continue.', exitCode });
  }
  if (/\(HTTP 40[34]\)\s*$/im.test(stderr)) {
    return new GhOperationError({ code: 'GH_ACCESS_DENIED', operation, message: 'This GitHub account cannot perform the operation. Check repository permissions, token permissions and organisation SSO policies.', exitCode });
  }
  if (/\bdial tcp\b|\bno such host\b|\btls handshake\b/i.test(stderr)) {
    return new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: 'Could not connect to GitHub. Check your network and try again.', exitCode, retryable: true });
  }
  if (/^(?:gh: )?unknown (?:shorthand )?flag\b|^(?:gh: )?unknown command\b/im.test(stderr)) {
    return new GhOperationError({ code: 'GH_CLI_INCOMPATIBLE', operation, message: 'This action needs a newer GitHub CLI. Update gh and try again.', exitCode });
  }
  if (/Head branch was modified|head sha.*(?:did not|does not|didn't) match|expected head.*(?:did not|does not) match/i.test(stderr)) {
    return new GhOperationError({ code: 'GH_PR_STATE_CHANGED', operation, message: 'This pull request changed. Review it and try again.', exitCode });
  }
  const message = firstLine(stderr).replace(/^gh: /, '').replace(/^GraphQL: /, '');
  return new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: message || 'GitHub CLI could not complete the operation.', exitCode });
}
