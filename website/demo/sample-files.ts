// Launchpad, the sample repository behind the demo. Each file shows a different OpenTig viewer:
// Markdown with an alert, Mermaid, a table, task lists, and math; SVG; TypeScript; JSON; YAML.

export const sampleLogo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Launchpad">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2b3060" />
      <stop offset="1" stop-color="#131527" />
    </linearGradient>
    <linearGradient id="flame" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd27a" />
      <stop offset="1" stop-color="#ff7a59" />
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="16" fill="url(#tile)" />
  <path d="M20 34 13 45l7-1.5zM44 34l7 11-7-1.5z" fill="#6f7ae0" />
  <path d="M32 9c8 5 12 13 12 23v9l-5 5H25l-5-5v-9c0-10 4-18 12-23z" fill="#9da8ff" />
  <circle cx="32" cy="27" r="5.5" fill="#131527" />
  <circle cx="32" cy="27" r="2.6" fill="#d6dbff" />
  <path d="M26.5 47h11L32 57.5z" fill="url(#flame)" />
</svg>
`;

export const sampleReadme = `<p align="center">
  <img src="assets/logo.svg" width="72" alt="Launchpad logo">
</p>

<h1 align="center">Launchpad</h1>

<p align="center">A small release board for teams shipping their first launch.<br>Plan the work, follow progress, and know what is left before release day.</p>

> [!TIP]
> Open \`index.html\` and switch to **Preview** to see the board this repository builds.

## Features

- **One board, three columns.** Up next, in progress, and shipped, with owners and labels.
- **Search that stays focused.** \`filterTasks\` matches task titles as you type.
- **Typed task model.** Shared types in [\`src/types.ts\`](src/types.ts) keep the board and its data in step.
- **No build step.** Plain ES modules that run in Node.js 24 and the browser.

## How a task moves

\`\`\`mermaid
flowchart LR
  idea([Idea]) --> next[Up next]
  next --> progress[In progress]
  progress --> review{Review}
  review -- changes requested --> progress
  review -- approved --> shipped([Shipped])
\`\`\`

## Quick start

\`\`\`bash
npm install
npm test
npm run preview
\`\`\`

\`\`\`ts
import { filterTasks } from './src/filter-tasks.js';
import { releaseProgress } from './src/progress.ts';

const visible = filterTasks(tasks, 'landing');
console.log(releaseProgress(tasks)); // { done: 2, total: 4, percent: 50 }
\`\`\`

## Scripts

| Script | What it does |
| --- | --- |
| \`npm test\` | Runs the task filter tests with \`node --test\`. |
| \`npm run lint\` | Type-checks \`src/\` with TypeScript. |
| \`npm run preview\` | Serves \`index.html\` on port 4173. |

## Release checklist

Progress is the share of shipped tasks, $p = \\frac{shipped}{total} \\times 100$.

- [x] Set up the test suite
- [x] Write the release notes
- [ ] Filter tasks by status
- [ ] Design the landing page
`;

export const sampleTypes = `/** Where a task sits on the release board. */
export type TaskStatus = 'next' | 'in-progress' | 'shipped';

export type Label = 'design' | 'feature' | 'docs' | 'engineering';

export interface Task {
  id: \`LP-\${number}\`;
  title: string;
  status: TaskStatus;
  owner: string;
  labels: readonly Label[];
  completed: boolean;
  /** ISO date, when the task has a deadline. */
  due?: string;
}

export interface Release {
  version: \`\${number}.\${number}.\${number}\`;
  name: string;
  date: string;
  tasks: Task[];
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  next: 'Up next',
  'in-progress': 'In progress',
  shipped: 'Shipped',
};
`;

export const sampleProgress = `import type { Task, TaskStatus } from './types.ts';

export interface Progress {
  done: number;
  total: number;
  percent: number;
}

/** Share of shipped tasks, rounded to a whole percent. */
export function releaseProgress(tasks: readonly Task[]): Progress {
  const done = tasks.filter((task) => task.status === 'shipped').length;
  const total = tasks.length;

  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

/** Group tasks into board columns, keeping their original order. */
export function groupByStatus(tasks: readonly Task[]): Map<TaskStatus, Task[]> {
  const columns = new Map<TaskStatus, Task[]>([
    ['next', []],
    ['in-progress', []],
    ['shipped', []],
  ]);

  for (const task of tasks) columns.get(task.status)?.push(task);
  return columns;
}
`;

export const sampleTasks = `{
  "release": {
    "version": "1.0.0",
    "name": "Launch",
    "date": "2026-02-03"
  },
  "tasks": [
    { "id": "LP-14", "title": "Design the landing page", "status": "next", "owner": "Alex", "labels": ["design"], "completed": false, "due": "2026-01-28" },
    { "id": "LP-12", "title": "Filter tasks by status", "status": "in-progress", "owner": "Sam", "labels": ["feature"], "completed": false, "due": "2026-01-22" },
    { "id": "LP-9", "title": "Write the release notes", "status": "shipped", "owner": "Alex", "labels": ["docs"], "completed": true },
    { "id": "LP-7", "title": "Set up the test suite", "status": "shipped", "owner": "Sam", "labels": ["engineering"], "completed": true }
  ]
}
`;

export const sampleWorkflow = `name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npm test

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npm run lint

  preview:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/upload-artifact@v4
        with:
          name: board-preview
          path: index.html
`;

export const samplePackage = `{
  "name": "launchpad",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "lint": "tsc --noEmit",
    "preview": "npx --yes serve --listen 4173 ."
  },
  "devDependencies": {
    "typescript": "^5.9.0"
  }
}
`;

export const sampleTsconfig = `{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "strict": true,
    "allowJs": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src"]
}
`;
