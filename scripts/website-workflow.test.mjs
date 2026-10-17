import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

const workflow = parse(readFileSync(new URL('../.github/workflows/website.yml', import.meta.url), 'utf8'));

it('allows production website deployment only through a manual upstream main run', () => {
  expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
  expect(workflow.permissions).toEqual({ contents: 'read' });
  expect(Object.keys(workflow.jobs)).toEqual(['deploy']);
  expect(workflow.jobs.deploy.if).toBe("github.repository == 'jorgefl8/opentig' && github.ref == 'refs/heads/main'");
  expect(workflow.jobs.deploy.environment).toBe('website-production');
  expect(workflow.concurrency['cancel-in-progress']).toBe(false);
});

it('validates and builds before upload, keeps deploy credentials out of build steps and pins actions', () => {
  const job = workflow.jobs.deploy;
  const steps = job.steps;
  const indexOf = command => steps.findIndex(step => step.run === command);
  expect(indexOf('npm ci --ignore-scripts')).toBeGreaterThan(-1);
  expect(indexOf('npm run check:website')).toBeGreaterThan(indexOf('npm ci --ignore-scripts'));
  expect(indexOf('npm run build:website')).toBeGreaterThan(indexOf('npm run check:website'));
  expect(indexOf('npm exec -- wrangler deploy')).toBeGreaterThan(indexOf('npm run build:website'));
  expect(job.env).not.toHaveProperty('CLOUDFLARE_API_TOKEN');
  expect(job.env).not.toHaveProperty('CLOUDFLARE_ACCOUNT_ID');
  for (const step of steps) {
    if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
    if (step.run?.startsWith('npm ') && step.run !== 'npm exec -- wrangler deploy') {
      expect(step.env).toBeUndefined();
    }
  }
  const deploy = steps[indexOf('npm exec -- wrangler deploy')];
  expect(deploy['working-directory']).toBe('website');
  expect(deploy.env.CLOUDFLARE_API_TOKEN).toBe('${{ secrets.CLOUDFLARE_API_TOKEN }}');
  expect(deploy.env.CLOUDFLARE_ACCOUNT_ID).toBe('${{ secrets.CLOUDFLARE_ACCOUNT_ID }}');
});
