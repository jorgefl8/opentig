# Contributing to OpenTig

## Before starting

- Search existing issues before opening a new one.
- Keep each change focused and preserve local-first behavior.
- Discuss broad product or architecture changes before implementation.
- Never include credentials, repository contents, generated builds, or local agent files.

## Local setup

Requirements: Node.js 24.15+, npm 11+, and Git on `PATH`. Development can run on Linux; Windows installer checks require Windows. See [development and packaging](docs/development.md).

```powershell
npm ci
npm start
```

## Quality gates

Application changes must pass:

```powershell
npm run check
```

Validate the affected runtime using the [development guide](docs/development.md): build and restart web Dev for server/browser changes, or package and launch desktop Dev for desktop changes. Documentation-only changes require checking links, anchors, examples, and documented commands; they do not require rebuilding or restarting the application.

Add focused tests for behavior changes. Keep Electron security boundaries intact: renderer code must not gain direct Node.js, filesystem, process, or unrestricted IPC access.

## Documentation

Keep the root `README.md` concise: it is the project overview and entry point for installation and documentation. Update it when the overview, basic setup, headline capabilities, or guide navigation changes.

Whenever a feature is added or its user-visible behavior changes, update the relevant guide under `docs/` in the same change. Prefer the existing section that covers the workflow; add a focused guide and link it from [the documentation index](docs/README.md) when the topic needs its own page. Describe current behavior, defaults, requirements, and important limits without appending a changelog-style entry or duplicating details across guides. Keep feature information in durable product documentation rather than only in code or review notes.

Check relative links, heading anchors, and commands against the repository. Keep local development configuration, private endpoints, screenshots for review, mockups, logs, and validation reports outside tracked documentation.

## Commits and pull requests

- Use focused Conventional Commits such as `fix(git): preserve rename paths`.
- Explain non-obvious security, compatibility, or migration decisions in commit bodies.
- Include reproduction steps and verification results in pull requests.
- Keep unrelated formatting or dependency changes out of feature commits.
