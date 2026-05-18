import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  dts: false,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: [
    '@tailwindcss/vite',
    'tailwindcss',
    'vite',
  ],
  esbuildOptions(options) {
    options.platform = 'node'
  },
})
