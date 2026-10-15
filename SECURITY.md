# Security policy

## Supported versions

OpenTig is pre-release software. Security fixes target the latest code on `main`; older builds are not supported.

## Reporting a vulnerability

**Report suspected vulnerabilities privately, not in a public issue.**

1. Open the repository's **Security** tab and use GitHub's private vulnerability reporting.
2. If private reporting is unavailable, contact the maintainer privately through their GitHub profile.

Include:

- Affected versions.
- Steps to reproduce the problem.
- The potential impact.
- Any suggested mitigation.

Do not include real credentials or sensitive repository data. Reports will be acknowledged as soon as practical; coordinated disclosure is preferred.

## Security model

The renderer is treated as untrusted. Git, filesystem, and optional provider operations run on the repository host in the shared server, through authenticated and validated commands. Electron main and preload provide narrow desktop-native capabilities through validated IPC contracts.

Git and optional provider CLIs execute without a shell and with bounded input, output, and runtime. See [security and privacy](docs/security-and-privacy.md) for trust boundaries, pairing, local data, and AI context.
