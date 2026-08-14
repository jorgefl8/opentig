# JustGit

JustGit is a focused, local-first Git desktop client for Windows. It combines a compact repository workflow with file browsing, syntax-aware diffs, history, worktrees, and optional commit-message assistance from locally installed AI CLIs.

> [!NOTE]
> JustGit is pre-release software. Back up important work and review Git operations before confirming them.

## Features

- Open local repositories and switch between existing worktrees.
- Browse staged and unstaged changes as a list or recursive tree.
- Stage, unstage, discard, and commit selected changes.
- Review unified or split diffs with syntax highlighting.
- Browse repository files and commit history without loading everything eagerly.
- Switch branches with safeguards for locked, prunable, bare, or busy worktrees.
- Inspect pull requests and create them through an authenticated GitHub CLI session.
- Generate editable commit messages with Codex, Claude Code, or OpenCode.
- Persist local UI preferences without storing repository contents or credentials.

## Requirements

- Windows 10 or later
- Node.js 24 or later
- npm 11 or later
- Git available on `PATH`

Optional integrations require their own installed and authenticated CLI:

```powershell
gh auth login
codex login
claude auth login
opencode auth login
```

## Development

```powershell
npm ci
npm start
```

Run all quality gates:

```powershell
npm run check
```

Build an unpacked application or distributable artifacts:

```powershell
npm run package
npm run make
```

The unpacked executable is written to `out/JustGit-win32-x64/JustGit.exe`.

## Architecture

- `src/main`: Electron main process, Git execution, filesystem access, persistence, and external CLI integrations.
- `src/preload.ts`: narrow, typed bridge exposed to the renderer.
- `src/renderer`: React interface and feature modules.
- `src/shared`: IPC contracts, shared models, and validation helpers.

The renderer has no direct Node.js access. Privileged work stays in the main process behind explicit IPC handlers. Git commands use argument arrays with `shell: false`, bounded output, timeouts, and per-repository write serialization.

## AI privacy

Commit-message generation is optional. JustGit sends the selected local CLI only a bounded staged diff, its summary, the branch name, and up to ten recent commit subjects. It does not send unstaged content or untracked files. Generated text remains editable and never creates a commit automatically.

JustGit does not read or persist API tokens. Provider CLIs use their own local authentication.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues must follow [SECURITY.md](SECURITY.md).

## License

JustGit source code is available under the [MIT License](LICENSE). Bundled third-party assets retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
