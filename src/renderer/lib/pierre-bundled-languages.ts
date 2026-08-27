/** Curated Pierre/Shiki grammars. Keep each loader as a static `import()` so Vite
 *  only emits these language chunks, not `bundledLanguages` from `shiki`. */
const javascript = () => import('@shikijs/langs/javascript');
const typescript = () => import('@shikijs/langs/typescript');
const jsx = () => import('@shikijs/langs/jsx');
const tsx = () => import('@shikijs/langs/tsx');
const json = () => import('@shikijs/langs/json');
const jsonc = () => import('@shikijs/langs/jsonc');
const html = () => import('@shikijs/langs/html');
const css = () => import('@shikijs/langs/css');
const scss = () => import('@shikijs/langs/scss');
const less = () => import('@shikijs/langs/less');
const markdown = () => import('@shikijs/langs/markdown');
const mdx = () => import('@shikijs/langs/mdx');
const yaml = () => import('@shikijs/langs/yaml');
const toml = () => import('@shikijs/langs/toml');
const xml = () => import('@shikijs/langs/xml');
const sql = () => import('@shikijs/langs/sql');
const python = () => import('@shikijs/langs/python');
const go = () => import('@shikijs/langs/go');
const rust = () => import('@shikijs/langs/rust');
const java = () => import('@shikijs/langs/java');
const kotlin = () => import('@shikijs/langs/kotlin');
const c = () => import('@shikijs/langs/c');
const cpp = () => import('@shikijs/langs/cpp');
const csharp = () => import('@shikijs/langs/csharp');
const ruby = () => import('@shikijs/langs/ruby');
const php = () => import('@shikijs/langs/php');
const swift = () => import('@shikijs/langs/swift');
const shellscript = () => import('@shikijs/langs/shellscript');
const powershell = () => import('@shikijs/langs/powershell');
const docker = () => import('@shikijs/langs/docker');
const diff = () => import('@shikijs/langs/diff');
const vue = () => import('@shikijs/langs/vue');
const svelte = () => import('@shikijs/langs/svelte');
const graphql = () => import('@shikijs/langs/graphql');
const lua = () => import('@shikijs/langs/lua');
const r = () => import('@shikijs/langs/r');
const dart = () => import('@shikijs/langs/dart');
const elixir = () => import('@shikijs/langs/elixir');
const haskell = () => import('@shikijs/langs/haskell');
const zig = () => import('@shikijs/langs/zig');
const nix = () => import('@shikijs/langs/nix');
const proto = () => import('@shikijs/langs/proto');
const hcl = () => import('@shikijs/langs/hcl');
const makefile = () => import('@shikijs/langs/makefile');
const ini = () => import('@shikijs/langs/ini');
const scala = () => import('@shikijs/langs/scala');
const perl = () => import('@shikijs/langs/perl');

const curated = {
  javascript, js: javascript, cjs: javascript, mjs: javascript,
  typescript, ts: typescript, cts: typescript, mts: typescript,
  jsx, tsx,
  json, jsonc,
  html, css, scss, less,
  markdown, md: markdown, mdx,
  yaml, yml: yaml, toml, xml, sql,
  python, py: python,
  go, rust, rs: rust,
  java, kotlin, kt: kotlin, kts: kotlin,
  c, cpp, 'c++': cpp,
  csharp, cs: csharp, 'c#': csharp,
  ruby, rb: ruby,
  php, swift,
  shellscript, bash: shellscript, sh: shellscript, shell: shellscript, zsh: shellscript,
  powershell, ps: powershell, ps1: powershell,
  docker, dockerfile: docker,
  diff,
  vue, svelte,
  graphql, gql: graphql,
  lua, r, dart,
  elixir, haskell, hs: haskell, zig, nix,
  proto, protobuf: proto,
  hcl, terraform: hcl, tf: hcl, tfvars: hcl,
  makefile, make: makefile,
  ini, properties: ini,
  scala, perl,
} as const;

function plaintextLoader(name: string) {
  return () => Promise.resolve({ default: [{ name, scopeName: `source.${name}`, patterns: [] }] });
}

/** Pierre's resolveLanguage uses hasOwnProperty + bundledLanguages[lang]. Unknown
 *  names must not throw; they highlight as plaintext instead of crashing the viewer. */
export const bundledLanguages = new Proxy(curated, {
  get(target, prop, receiver) {
    if (typeof prop === 'string' && prop in target) return Reflect.get(target, prop, receiver);
    if (typeof prop === 'string') return plaintextLoader(prop);
    return Reflect.get(target, prop, receiver);
  },
  has(_target, prop) {
    return typeof prop === 'string';
  },
  getOwnPropertyDescriptor(target, prop) {
    if (typeof prop !== 'string') return Object.getOwnPropertyDescriptor(target, prop);
    return { configurable: true, enumerable: true, value: prop in target ? target[prop as keyof typeof target] : plaintextLoader(prop) };
  },
});
