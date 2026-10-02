# Third-party notices

## Geist, Inconsolata, JetBrains Mono, Plus Jakarta Sans, and Space Grotesk

OpenTig bundles these variable fonts via Fontsource.

- [Geist](https://vercel.com/font): SIL Open Font License 1.1, Vercel
- [Inconsolata](https://fonts.google.com/specimen/Inconsolata): SIL Open Font License 1.1, Raph Levien
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/): SIL Open Font License 1.1, JetBrains
- [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans): SIL Open Font License 1.1, Tokotype / Gumpita Rahayu
- [Space Grotesk](https://floriankarsten.github.io/space-grotesk/): SIL Open Font License 1.1, Florian Karsten Typefaces

## Departure Mono

OpenTig vendors [Departure Mono](https://departuremono.com/) (v1.500) as a selectable monospaced pixel font for diffs and the editor.

- Author: Helena Zhang
- License: SIL Open Font License 1.1
- Files: `src/renderer/assets/fonts/departure-mono/`

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

## Grok provider mark

The Grok SVG path in `AiProviderIcon.tsx` is adapted from [Lobe Icons](https://github.com/lobehub/lobe-icons/blob/master/src/Grok/components/Mono.tsx). It identifies the selected CLI provider; the mark remains subject to its owner's trademark terms and does not imply endorsement.

MIT License

Copyright (c) 2023 LobeHub

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
