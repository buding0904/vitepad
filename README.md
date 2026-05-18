<div align="center">
  <h1>vitepad</h1>

  <p><strong>Run any single frontend file with Vite</strong></p>

  <p>
    <a href="https://www.npmjs.com/package/@buding0904/vitepad"><img src="https://img.shields.io/npm/v/@buding0904/vitepad.svg" alt="npm version" /></a>
    <a href="./LICENSE"><img src="https://img.shields.io/npm/l/@buding0904/vitepad.svg" alt="license" /></a>
    <img src="https://img.shields.io/badge/frameworks-React%20%7C%20Preact%20%7C%20Solid%20%7C%20Vue%20%7C%20Svelte-blue" alt="frameworks" />
    <img src="https://img.shields.io/badge/Tailwind-v4-38bdf8" alt="Tailwind CSS" />
  </p>
</div>

---

`vitepad` creates a temporary Vite playground for one entry file. Use it to preview a component, test a small main entry, or compare the same file across different framework versions without creating a project or changing the current project's dependencies.

Tailwind CSS is enabled by default. Framework packages are resolved to exact npm versions, downloaded on demand, and cached under `~/.cache/vitepad/frameworks`. No ESLint, Biome, Husky, or formatting pipeline is included.

## Features

**Single-file Vite runner**

- Run `App.tsx`, `App.vue`, `App.svelte`, `main.ts`, `demo.js`, and similar files directly
- `.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, and `.cts` are treated as main entry files
- `.jsx`, `.tsx`, `.vue`, and `.svelte` are treated as App component files and mounted into `#root`
- Extra Vite config can be merged with `--config`

**Frameworks**

- Built-in component wrappers for React, Preact, Solid, Vue, and Svelte
- JSX/TSX framework inference from imports, with React as the fallback
- Explicit framework selection with `--framework react`, `--framework vue`, etc.
- Version specs are supported, such as `react@18`, `vue@3.4`, `svelte@5`, or `react@latest`

**Version testing**

- Test the same component against different framework versions without touching `package.json`
- `latest` and semver ranges are resolved to exact versions before caching
- Cache keys use exact versions, for example `react-19.2.6`
- `--force-install` recreates the selected framework cache

**Styling and environment**

- Tailwind CSS v4 is available by default through `@tailwindcss/vite`
- User project `node_modules` is not modified
- Framework dependencies are exposed through the temporary Vite workspace
- No linting or formatting toolchain is installed

## Install

```bash
npm install -g @buding0904/vitepad
```

```bash
pnpm add -g @buding0904/vitepad
```

```bash
yarn global add @buding0904/vitepad
```

## Quick Start

```bash
vitepad ./App.tsx
vitepad ./App.vue
vitepad ./App.svelte
vitepad ./main.ts
```

No install needed:

```bash
npx @buding0904/vitepad ./App.tsx
pnpm dlx @buding0904/vitepad ./App.vue
```

## Framework Version Testing

Run the same entry with different framework versions:

```bash
vitepad ./App.tsx --framework react@18
vitepad ./App.tsx --framework react@19
vitepad ./App.tsx --framework react@latest
```

```bash
vitepad ./App.vue --framework vue@3.4
vitepad ./App.vue --framework vue@latest
```

```bash
vitepad ./App.svelte --framework svelte@4
vitepad ./App.svelte --framework svelte@5
```

## CLI

```bash
vitepad <entry> [options]
```

### Options

| Option | Description |
|--------|-------------|
| `<entry>` | Entry file to run |
| `-f, --framework <name>` | `auto`, `react`, `preact`, `solid`, `vue`, `svelte`, or `vanilla`; version specs are supported, e.g. `react@18` |
| `--force-install` | Reinstall the selected framework cache |
| `-p, --port <number>` | Dev server port (default: `8000`) |
| `--host <host>` | Dev server host (default: `0.0.0.0`) |
| `--no-open` | Do not open the browser automatically |
| `-c, --config <file>` | Merge an extra Vite config file |
| `-h, --help` | Show help |

Examples:

```bash
vitepad ./App.tsx --framework react@18 --port 3000
vitepad ./App.vue --host 127.0.0.1 --no-open
vitepad ./App.svelte --config ./vite.extra.js
vitepad ./App.tsx --framework react@latest --force-install
```

## Entry Rules

| Extension | Mode | Behavior |
|-----------|------|----------|
| `.js`, `.mjs`, `.cjs` | main | Imported as the app entry |
| `.ts`, `.mts`, `.cts` | main | Imported as the app entry |
| `.jsx`, `.tsx` | component | Mounted as an App component |
| `.vue` | component | Mounted with Vue |
| `.svelte` | component | Mounted with Svelte |

For main entry files, the file is responsible for mounting itself. For component entry files, vitepad creates the framework-specific mount code.

## Cache

Framework versions are resolved before installation:

```bash
vitepad ./App.tsx --framework react
# react@latest -> react@19.2.6
```

Framework caches are stored in:

```text
~/.cache/vitepad/frameworks
```

Example cache directory:

```text
~/.cache/vitepad/frameworks/react-19.2.6
```

If a framework version is not cached, vitepad downloads it and prints install progress. The user's working directory and `node_modules` are left untouched.

## Local Development

```bash
pnpm install
pnpm run build
pnpm run typecheck
pnpm run smoke
```

`pnpm run smoke` starts temporary Vite servers for main, React, Preact, Solid, Vue, and Svelte entries. It downloads framework caches on first run.

To test the CLI globally before publishing:

```bash
pnpm run build
pnpm link --global
```

Then run it from another project:

```bash
cd /path/to/project
vitepad ./src/App.tsx
```

Uninstall the linked global command:

```bash
pnpm remove --global @buding0904/vitepad
```

## License

MIT
