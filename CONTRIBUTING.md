# Contributing to OpenTig

## Before starting

- Search existing issues before opening a new one.
- Keep each change focused and preserve local-first behavior.
- Discuss broad product or architecture changes before implementation.
- Never include credentials, repository contents, generated builds, or local agent files.

## Local setup

Requirements: Node.js 24+, npm 11+, and Git on `PATH`. Development can run on Linux; Windows installer checks require Windows. See [development and packaging](docs/development.md).

```powershell
npm ci
npm start
```

## Quality gates

Every change must pass:

```powershell
npm run check
npm run package:dev
```

Add focused tests for behavior changes. Keep Electron security boundaries intact: renderer code must not gain direct Node.js, filesystem, process, or unrestricted IPC access.

## Commits and pull requests

- Use focused Conventional Commits such as `fix(git): preserve rename paths`.
- Explain non-obvious security, compatibility, or migration decisions in commit bodies.
- Include reproduction steps and verification results in pull requests.
- Keep unrelated formatting or dependency changes out of feature commits.
