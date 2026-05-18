# vitepad

Run a single frontend file with Vite.

```sh
npm install -g @buding0904/vitepad
pnpm add -g @buding0904/vitepad
```

```sh
vitepad ./demo.tsx
vitepad ./demo.vue
vitepad ./demo.svelte
vitepad ./main.ts
```

Rules:

- `.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, and `.cts` are treated as main entry files.
- `.jsx`, `.tsx`, `.vue`, and `.svelte` are treated as App component files and mounted into `#root`.
- Tailwind CSS is available by default through `@tailwindcss/vite`.
- No ESLint, Biome, Husky, or formatting/linting pipeline is included.
- Main entry files can use any Vite-compatible framework as long as the file mounts itself.
- Component entry files have built-in wrappers for React, Preact, Solid, Vue, and Svelte.

For ambiguous JSX/TSX entries, vitepad infers the framework from imports and falls back to React:

```sh
vitepad ./App.tsx --framework react
vitepad ./App.tsx --framework react@18
vitepad ./App.tsx --framework preact
vitepad ./App.tsx --framework solid
```

Framework versions:

- `--framework react` uses `react@latest`.
- `--framework react@18` uses `react@18` and `react-dom@18`.
- `--framework vue@3.4`, `svelte@5`, `solid@1`, and `preact@10` follow the same pattern.
- Framework version ranges are resolved to exact npm versions before caching.
- Framework packages are downloaded on first use into `~/.cache/vitepad/frameworks`, for example `react-19.2.6`.
- User project dependencies still resolve from the user's working directory; vitepad only aliases framework core packages to its cache.
- Use `--force-install` to recreate the selected framework cache.

Options:

```sh
vitepad ./App.vue --port 3000 --host 127.0.0.1 --no-open
vitepad ./App.tsx --config ./vite.extra.js
vitepad ./App.tsx --framework react@18 --force-install
```

Development:

```sh
pnpm install
pnpm run build
pnpm run smoke
```

`pnpm run smoke` runs `test/smoke.mjs`, starting a temporary Vite server for main, React, Preact, Solid, Vue, and Svelte entries. It downloads framework caches on first run.

Publish:

```sh
pnpm run release
```

`prepublishOnly` runs `pnpm run build`, so npm publishes the generated `dist` directory.
