# Security policy

## Supported versions

OpenTig is pre-release software. Security fixes target the latest code on `main`; older builds are not supported.

## Reporting a vulnerability

Do not disclose suspected vulnerabilities in a public issue. Use GitHub's private vulnerability reporting from the repository's **Security** tab. If private reporting is unavailable, contact the maintainer privately through their GitHub profile.

Include affected versions, reproduction steps, impact, and any suggested mitigation. Do not include real credentials or sensitive repository data. Reports will be acknowledged as soon as practical and coordinated disclosure is preferred.

## Security model

The renderer is treated as untrusted. Privileged operations run in the Electron main process through validated IPC contracts. Git and optional provider CLIs execute without a shell and with bounded input, output, and runtime.
