import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isWebsitePath } from './change-scope.mjs';

// Prose and the separately validated public site are exempt. Application docs
// assets, examples, configuration, and scripts still require the complete CI.
const isDocumentation = (file) => /^(?:README\.md|CONTRIBUTING\.md|AGENTS\.md|THIRD_PARTY_NOTICES\.md|docs\/.+\.md)$/.test(file);

export function needsValidation(eventName, event, head, cwd = process.cwd()) {
  if (eventName === 'workflow_dispatch') return true;
  const base = eventName === 'pull_request' ? event.pull_request?.base?.sha : eventName === 'push' ? event.before : null;
  if (!base || !/^[a-f0-9]{40}$/.test(base) || /^0+$/.test(base) || !head || !/^[a-f0-9]{40}$/.test(head)) return true;
  try {
    // No rename detection: moving code into docs must include its old path.
    const files = execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', base, head, '--'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\0').filter(Boolean);
    return files.length === 0 || files.some((file) => !isDocumentation(file) && !isWebsitePath(file));
  } catch {
    // Missing history must never silently skip validation.
    return true;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const required = needsValidation(process.env.GITHUB_EVENT_NAME, event, process.env.GITHUB_SHA);
  appendFileSync(process.env.GITHUB_OUTPUT, `required=${required}\n`);
  console.log(required ? 'Complete application validation required.' : 'Documentation or public website only: heavy application CI jobs can be skipped.');
}
