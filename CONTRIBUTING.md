# Contributing to OpenTig

## Before starting

- Search existing issues before opening a new one.
- Keep each change focused and preserve local-first behavior.
- Discuss broad product or architecture changes before implementation.
- Never include credentials, repository contents, generated builds, or local agent files.

## Local setup

Use Node.js 24.15+, [pnpm](https://pnpm.io/installation) 12+, and Git on `PATH`. Development can run on Linux; Windows installer checks require Windows.

For desktop development:

```powershell
pnpm install
pnpm start
```

See [development and packaging](docs/development.md) for browser development, Dev profiles, and packaging, or the [website guide](docs/website.md) to work on the public site.

## Quality gates

### Application changes

Run the application checks:

```powershell
pnpm run check
```

Add focused tests for behavior changes. Keep Electron security boundaries intact: renderer code must not gain direct Node.js, filesystem, process, or unrestricted IPC access.

Validate the affected runtime using the [development guide](docs/development.md):

- **Server or browser changes:** build and restart web Dev.
- **Desktop changes:** package and launch desktop Dev.

Changes to shared dependencies or release/CI tooling also require the application checks.

### Website and documentation changes

For public website changes or edits to a published guide, run:

```bash
pnpm run check:website
pnpm run build:website
```

For documentation changes, check links, heading anchors, examples, and documented commands against the repository. Documentation-only changes do not require rebuilding or restarting the application. Website development does not require packaging or restarting the desktop application or CLI server.

See the repository's [website contribution guide](docs/website.md) for the publication list, local preview, and validation. Maintainers handle production publication separately.

## Documentation

**Update the relevant guide in the same change as the feature.** This applies whenever a feature is added or its user-visible behavior changes.

- Use the existing workflow section when possible. If the topic needs its own page, add a focused guide under `docs/` and link it from [the documentation index](docs/README.md).
- Describe current behavior, defaults, requirements, and important limits. Avoid changelog-style additions and duplicated detail across guides.
- Keep feature information in durable product documentation, not only in code or review notes.
- Keep the root `README.md` concise as the project overview and entry point. Update it when the overview, basic setup, headline capabilities, or guide navigation changes.

The public site reads the original repository Markdown. Edit that source; do not create a second copy under `website/`. Follow the [website publication workflow](docs/website.md#published-documentation) to add a public guide. Only explicitly listed guides are published. Contributor-only website references stay in the repository, and production runbooks stay outside Git. A commit or push does not deploy the website.

Keep local development configuration, private endpoints, screenshots for review, mockups, logs, and validation reports outside tracked documentation.

## Commits and pull requests

- Use focused Conventional Commits such as `fix(git): preserve rename paths`.
- Explain non-obvious security, compatibility, or migration decisions in commit bodies.
- Include reproduction steps and verification results in pull requests.
- Keep unrelated formatting or dependency changes out of feature commits.
