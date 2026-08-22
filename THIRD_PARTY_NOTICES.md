# Third-party notices

## vscode-icons

Files under `public/vscode-icons/` and the derived mapping in `src/renderer/assets/vscode-icons-theme.json` originate from the [vscode-icons project](https://github.com/vscode-icons/vscode-icons).

- Project source code: MIT License
- Icons: [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/)
- Branded icons: remain subject to their respective owners' copyright and trademark terms

The assets are bundled for file-type identification. OpenTig does not claim ownership of third-party marks and does not imply endorsement by their owners.

## trash

OpenTig uses the [`trash`](https://github.com/sindresorhus/trash) package to move files and folders to system Trash on Windows, macOS, and Linux.

- Version: 10.1.1
- License: MIT
- Linux support follows the XDG Trash specification; upstream documents it as weakly maintained, so OpenTig runs an Ubuntu Trash smoke test as a release gate.

## ws

OpenTig uses [`ws`](https://github.com/websockets/ws) for its authenticated server WebSocket transport.

- Version: 8.21.3
- License: MIT

## uqr

OpenTig uses [`uqr`](https://github.com/unjs/uqr) to render one-use Web Access pairing links as QR codes locally in the renderer.

- Version: 0.1.3
- License: MIT
