# Third-party notices

## PDF.js and parse5

The browser client bundles [PDF.js](https://github.com/mozilla/pdf.js) under Apache License 2.0, copyright Mozilla Foundation, including adapted text-layer styles. Its license and the notices for its fonts, CMaps, and WebAssembly decoders are included under `dist/client/pdfjs/`.

The server bundles [parse5](https://github.com/inikulin/parse5) under the MIT License to embed local assets in HTML previews.

## Fonts and KaTeX

The browser client bundles these fonts under the SIL Open Font License 1.1. Their copyright notices and license texts are included under `dist/client/licenses/`.

- [Geist and Geist Mono](https://vercel.com/font): The Geist Project Authors
- [Inconsolata](https://fonts.google.com/specimen/Inconsolata): The Inconsolata Project Authors
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/): The JetBrains Mono Project Authors
- [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans): The Plus Jakarta Sans Project Authors
- [Space Grotesk](https://floriankarsten.github.io/space-grotesk/): The Space Grotesk Project Authors
- [Departure Mono](https://departuremono.com/) v1.500: Helena Zhang

[KaTeX](https://github.com/KaTeX/KaTeX) and its fonts render Markdown math under the MIT License, copyright Khan Academy and other contributors. Its license is `dist/client/licenses/katex-LICENSE.txt`.

## vscode-icons and Tabler Icons

Files bundled into the production client originate from the [vscode-icons project](https://github.com/vscode-icons/vscode-icons). Its license file is included as `dist/client/vscode-icons/LICENSE.txt`.

- Project source code: MIT License
- Icons: Creative Commons Attribution-ShareAlike 4.0 International
- Branded icons remain subject to their respective owners' copyright and trademark terms

Interface icons come from [Tabler Icons](https://github.com/tabler/tabler-icons) under the MIT License.

## trash

OpenTig uses [`trash`](https://github.com/sindresorhus/trash) 9.0.0 under the MIT License to move files and folders to system Trash on Windows, macOS, and Linux.

The version is pinned to avoid the unpatched `braces` dependency in 10.x ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)). Globbing is disabled. Under WSL, this version uses Linux Trash rather than the Windows Recycle Bin integration introduced in 10.x.

## ws

OpenTig uses [`ws`](https://github.com/websockets/ws) 8.22.0 under the MIT License for its authenticated WebSocket transport.

## uqr

OpenTig bundles [`uqr`](https://github.com/unjs/uqr) 0.1.3 into the CLI to render one-use pairing links as terminal QR codes. It is licensed under the MIT License.
