import type { CliRunResult } from '../ai/CliProcessRunner';
import { GhOperationError } from '../../shared/errors';

/** The most specific reason a GitHub CLI read failed, from its output. */
export function classifyFailure(result: CliRunResult, operation: string): GhOperationError {
  const raw = `${result.stderr}\n${result.stdout}`.toLowerCase();
  if (/not logged in|gh auth login|authentication|credential|bad credentials|http 401/.test(raw)) {
    return new GhOperationError({ code: 'GH_AUTH_REQUIRED', operation, message: 'Sign in with gh auth login to continue.', exitCode: result.exitCode });
  }
  if (/http 406|exceeded the maximum number of (files|lines)|diff is taking too long|too_large/.test(raw)) {
    return new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: 'GitHub cannot produce a diff this large, and Git could not download the pull request commits. Check the connection to the remote and try again.', exitCode: result.exitCode });
  }
  if (/rate limit|api rate|secondary rate/.test(raw)) {
    return new GhOperationError({ code: 'GH_RATE_LIMITED', operation, message: 'GitHub rejected the request because of a rate limit. Try again later.', exitCode: result.exitCode, retryable: true });
  }
  // "Could not resolve to a Repository" means no access, not a network failure.
  if (/could not resolve to a repository/.test(raw) && operation !== 'gh-pr-stack') return new GhOperationError({ code: 'GH_ACCESS_DENIED', operation, message: 'The repository was not found or is not accessible with this GitHub account.', exitCode: result.exitCode });
  if (/could not resolve|no such host|connection refused|connection reset|network|dial tcp|tls handshake/.test(raw)) {
    return new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: 'Could not connect to GitHub. Check your network and try again.', exitCode: result.exitCode, retryable: true });
  }
  if (/403|resource not accessible|insufficient.*scope|saml|sso/.test(raw)) return new GhOperationError({ code: 'GH_ACCESS_DENIED', operation, message: 'This GitHub account cannot perform the operation. Check repository permissions, token permissions and organisation SSO policies.', exitCode: result.exitCode });
  if (/404|could not resolve to a repository/.test(raw) && operation !== 'gh-pr-stack') return new GhOperationError({ code: 'GH_ACCESS_DENIED', operation, message: 'The repository was not found or is not accessible with this GitHub account.', exitCode: result.exitCode });
  const detail = firstLine(result.stderr) || firstLine(result.stdout);
  return new GhOperationError({ code: 'GH_PROCESS_FAILED', operation, message: detail || 'GitHub CLI could not complete the operation.', exitCode: result.exitCode });
}

function firstLine(value: string): string {
  return (value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '').slice(0, 300);
}
