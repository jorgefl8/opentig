import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { publishedSources } from '../website/docs.config.mjs';
import { isWebsitePath } from './change-scope.mjs';

// Prose and the separately validated public site are exempt. Application docs
// assets, examples, configuration, and scripts still require the complete CI.
// The AI writing policy is compiled into the application's prompts.
const applicationMarkdown = new Set(['docs/ai-writing-policy.md']);
// The install-scripts job runs each website install script against the packed
// CLI on three systems: only for the scripts and their checks, the CLI itself,
// how it is packed and released, its dependencies, and the job's own definition.
const installScriptFiles = new Set([
  'website/public/install.sh', 'website/public/install.ps1',
  'website/scripts/install-scripts.test.mjs', 'website/scripts/verify-install.mjs',
  'scripts/pack-headless.mjs', 'scripts/inspect-headless.mjs', 'scripts/headless-release.mjs',
  'scripts/smoke-npm-alias.mjs', 'scripts/bundled-npm.mjs',
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  '.github/workflows/ci.yml', '.github/workflows/headless-release.yml', 'scripts/ci-scope.mjs',
]);
const isInstallScriptPath = (file) => file.startsWith('packages/server/') || installScriptFiles.has(file);
const isDocumentation = (file) => !applicationMarkdown.has(file)
  && /^(?:README\.md|CONTRIBUTING\.md|SECURITY\.md|AGENTS\.md|THIRD_PARTY_NOTICES\.md|docs\/.+\.md)$/.test(file);

export function validationScope(eventName, event, head, cwd = process.cwd()) {
  const both = { required: true, website: true, installScripts: true };
  if (eventName === 'workflow_dispatch') return both;
  const base = eventName === 'pull_request' ? event.pull_request?.base?.sha : eventName === 'push' ? event.before : null;
  if (!base || !/^[a-f0-9]{40}$/.test(base) || /^0+$/.test(base) || !head || !/^[a-f0-9]{40}$/.test(head)) return both;
  try {
    // No rename detection: moving code into docs must include its old path.
    const files = execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', base, head, '--'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\0').filter(Boolean);
    if (!files.length) return both;
    return {
      required: files.some((file) => !isDocumentation(file) && !isWebsitePath(file)),
      website: files.some((file) => publishedSources.has(file) || ['website/', 'src/renderer/', 'src/shared/', 'public/'].some(prefix => file.startsWith(prefix)) || file === 'tsconfig.json' || [
        'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.oxlintrc.json', '.npmrc',
        '.github/workflows/ci.yml', '.github/workflows/website.yml', 'scripts/ci-scope.mjs', 'scripts/change-scope.mjs',
      ].includes(file)),
      installScripts: files.some(isInstallScriptPath),
    };
  } catch {
    // Missing history must never silently skip validation.
    return both;
  }
}

export function needsValidation(eventName, event, head, cwd = process.cwd()) {
  return validationScope(eventName, event, head, cwd).required;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const scope = validationScope(process.env.GITHUB_EVENT_NAME, event, process.env.GITHUB_SHA);
  appendFileSync(process.env.GITHUB_OUTPUT, `required=${scope.required}\nwebsite=${scope.website}\ninstall_scripts=${scope.installScripts}\n`);
  console.log(`Validation required: application=${scope.required}, website=${scope.website}, install scripts=${scope.installScripts}.`);
}
