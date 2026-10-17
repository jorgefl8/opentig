import { build } from "vite";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
const root = fileURLToPath(new URL("../../", import.meta.url));
const demo = path.join(root, "website/demo");
const outDir = path.join(root, "website/public/demo");
await build({
  configFile: false,
  root,
  base: "/demo/",
  publicDir: false,
  logLevel: "warn",
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "demo-boundaries",
      enforce: "pre",
      generateBundle() {
        const forbidden = [
          "/lib/server-client.ts",
          "/lib/websocket-transport.ts",
          "/settings/update-api.ts",
          "/settings/browser-web-access.ts",
          "/settings/owner-sessions.ts",
        ];
        for (const id of this.getModuleIds()) {
          if (
            forbidden.some((suffix) =>
              id.replaceAll("\\", "/").endsWith(suffix),
            )
          ) {
            this.error(
              `The public demo must not include a live server transport: ${id}`,
            );
          }
        }
      },
      resolveId(id, importer) {
        if (id === "./HtmlPreviewFrame" && importer?.includes("/features/viewer/"))
          return path.join(demo, "html-preview.tsx");
        if (id === "@/lib/opentig-api") return path.join(demo, "api.ts");
        if (
          id === "@/features/settings/SettingsDialog" ||
          (id === "./SettingsDialog" &&
            importer?.includes("/features/settings/"))
        )
          return path.join(demo, "settings.tsx");
        if (
          id === "@/features/settings/update-api" ||
          (id === "./update-api" && importer?.includes("/features/settings/"))
        )
          return path.join(demo, "updates.ts");
        if (
          id === "shiki" &&
          importer?.replaceAll("\\", "/").includes("@pierre/diffs/")
        )
          return path.join(root, "src/renderer/lib/pierre-shiki.ts");
      },
    },
  ],
  resolve: {
    alias: [
      { find: "@/lib/opentig-api", replacement: path.join(demo, "api.ts") },
      { find: "@/lib/websocket-transport", replacement: path.join(demo, "api.ts") },
      {
        find: "@/features/settings/SettingsDialog",
        replacement: path.join(demo, "settings.tsx"),
      },
      {
        find: "@/features/settings/update-api",
        replacement: path.join(demo, "updates.ts"),
      },
      { find: "@", replacement: path.join(root, "src/renderer") },
      { find: "@shared", replacement: path.join(root, "src/shared") },
    ],
  },
  worker: { format: "es" },
  build: {
    outDir,
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: path.join(demo, "main.tsx"),
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/react/")
          )
            return "react";
        },
      },
    },
  },
});
await mkdir(path.join(outDir, "vscode-icons"), { recursive: true });
// Keep the existing icon resolver and its complete set of public assets.
await cp(
  path.join(root, "public/vscode-icons"),
  path.join(outDir, "vscode-icons"),
  { recursive: true },
);
const manifest = JSON.parse(
  await readFile(path.join(outDir, ".vite/manifest.json"), "utf8"),
);
const entry = Object.values(manifest).find((item) => item.isEntry);
if (!entry) throw new Error("Demo entry is missing from Vite manifest.");
await writeFile(
  path.join(root, "website/.demo-manifest.json"),
  JSON.stringify({
    script: `/demo/${entry.file}`,
    styles: (entry.css ?? []).map((css) => `/demo/${css}`),
  }),
);
await rm(path.join(outDir, ".vite"), { recursive: true });
console.log("OpenTig demo built from the shared renderer.");
