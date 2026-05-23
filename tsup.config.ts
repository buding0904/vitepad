import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts', 'src/cli-runtime.ts'],
  format: ['esm', 'cjs'],
  dts: false,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: [
    'unocss',
    'unocss/vite',
    'vite',
  ],
  esbuildOptions(options) {
    options.platform = 'node'
  },
})
