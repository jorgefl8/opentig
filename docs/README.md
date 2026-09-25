# OpenTig documentation

[← OpenTig](../README.md)

Start with the overview in the root README, then choose a guide:

| Guide | What it covers |
| --- | --- |
| [Installation and CLI](getting-started.md) | Requirements, local browser use, Linux services, data directories, and updates |
| [Feature guide](features.md) | Repositories, projects, diffs, staging, commits, files, editing, search, history, branches, worktrees, GitHub PRs, optional AI, and shortcuts |
| [Remote access and pairing](web-access.md) | SSH tunnels, LAN access, HTTPS proxies, browser sessions, and revocation |
| [Security and AI privacy](security-and-privacy.md) | Trust boundaries, local data, permissions, and what optional AI receives |
| [Development and packaging](development.md) | Running from source, isolated Dev profiles, validation, and local packages |
| [Release automation](releases.md) | Drafts, tags, Windows installers, npm publication, and signing |
| [Architecture](architecture.md) | Shared server, Electron shell, browser transport, and source layout |

OpenTig is in early development. The published desktop installer targets Windows x64; the npm CLI supports Linux, macOS, and Windows. The browser accesses repositories on the machine running OpenTig. It does not upload repositories from your browsing device.
