import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createServer, mergeConfig, normalizePath, type PluginOption, type UserConfig } from 'vite'

import {
  appendPlugin,
  frameworkDedupe,
  frameworkOptimizeDeps,
  loadFrameworkPlugins,
  resolveFramework,
  type Framework,
  type FrameworkName,
  type FrameworkSpec,
  type ResolvedFramework,
} from './frameworks.js'

export type EntryMode = 'main' | 'component'
export type { Framework, FrameworkName, FrameworkSpec, ResolvedFramework }

export interface VitepadOptions {
  entry?: string
  framework: Framework
  frameworkVersion: string
  forceInstall: boolean
  port: number
  host: string
  open: boolean | string
  config?: string
  help: boolean
}

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)), '..')
const supportedComponentExts = new Set(['.jsx', '.tsx', '.vue', '.svelte'])
const supportedMainExts = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'])
const frameworkValues = new Set<Framework>(['auto', 'react', 'preact', 'solid', 'vue', 'svelte', 'vanilla'])

export async function run(argv: string[]): Promise<void> {
  const options = parseArgs(argv)

  if (options.help) {
    console.log(helpText())
    return
  }

  if (!options.entry) {
    throw new Error(helpText('Missing entry file.'))
  }

  const entry = path.resolve(process.cwd(), options.entry)
  const stat = await fs.stat(entry).catch(() => null)
  if (!stat?.isFile()) {
    throw new Error(`Entry file does not exist: ${entry}`)
  }

  const extension = path.extname(entry).toLowerCase()
  const mode = inferMode(extension)
  const source = await fs.readFile(entry, 'utf8')
  const framework = inferFramework({
    extension,
    source,
    requested: options.framework,
    version: options.frameworkVersion,
  })
  validateCombination({ mode, framework: framework.name, extension })

  const resolvedFramework = await resolveFramework(framework, { forceInstall: options.forceInstall })
  const workspace = await createWorkspace({ entry, mode, framework: resolvedFramework.name })
  const config = await loadUserConfig(options.config)

  const server = await createServer(mergeConfig({
    root: workspace,
    configFile: false,
    server: {
      host: options.host,
      port: options.port,
      open: options.open,
      fs: {
        allow: [
          rootDir,
          process.cwd(),
          path.dirname(entry),
          workspace,
          ...(resolvedFramework.cacheDir ? [resolvedFramework.cacheDir] : []),
        ],
      },
    },
    plugins: await loadPlugins(resolvedFramework),
    resolve: {
      alias: [
        ...resolvedFramework.aliases,
        {
          find: '@',
          replacement: path.dirname(entry),
        },
      ],
      dedupe: frameworkDedupe(resolvedFramework.name),
    },
    optimizeDeps: {
      entries: [path.join(workspace, 'src/main.js')],
      include: frameworkOptimizeDeps(resolvedFramework.name),
    },
  }, config))

  await server.listen()
  server.printUrls()
  console.log(`vitepad: ${resolvedFramework.name}@${resolvedFramework.version} ${mode} from ${entry}`)

  const close = async () => {
    await server.close()
    process.exit(0)
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
}

export function parseArgs(argv: string[]): VitepadOptions {
  const options: VitepadOptions = {
    framework: 'auto',
    frameworkVersion: 'latest',
    forceInstall: false,
    port: 8000,
    host: '0.0.0.0',
    open: '/',
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '-h' || arg === '--help') {
      options.help = true
    } else if (arg === '--framework' || arg === '-f') {
      Object.assign(options, parseFramework(readValue(argv, ++index, arg)))
    } else if (arg.startsWith('--framework=')) {
      Object.assign(options, parseFramework(arg.slice('--framework='.length)))
    } else if (arg === '--force-install') {
      options.forceInstall = true
    } else if (arg === '--port' || arg === '-p') {
      options.port = Number(readValue(argv, ++index, arg))
    } else if (arg.startsWith('--port=')) {
      options.port = Number(arg.slice('--port='.length))
    } else if (arg === '--host') {
      options.host = readValue(argv, ++index, arg)
    } else if (arg.startsWith('--host=')) {
      options.host = arg.slice('--host='.length)
    } else if (arg === '--no-open') {
      options.open = false
    } else if (arg === '--open') {
      options.open = '/'
    } else if (arg === '--config' || arg === '-c') {
      options.config = readValue(argv, ++index, arg)
    } else if (arg.startsWith('--config=')) {
      options.config = arg.slice('--config='.length)
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`)
    } else if (!options.entry) {
      options.entry = arg
    } else {
      throw new Error(`Unexpected argument: ${arg}`)
    }
  }

  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`)
  }

  return options
}

function parseFramework(value: string): Pick<VitepadOptions, 'framework' | 'frameworkVersion'> {
  const match = value.match(/^([^@]+)(?:@(.+))?$/)
  const name = match?.[1] as Framework | undefined
  const version = match?.[2] || 'latest'

  if (name && frameworkValues.has(name)) {
    return { framework: name, frameworkVersion: version }
  }
  throw new Error(`Unsupported framework "${value}". Use one of: ${[...frameworkValues].join(', ')}, optionally with @version.`)
}

function readValue(argv: string[], index: number, option: string): string {
  const value = argv[index]
  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${option}`)
  }
  return value
}

function inferMode(extension: string): EntryMode {
  if (supportedMainExts.has(extension)) return 'main'
  if (supportedComponentExts.has(extension)) return 'component'
  throw new Error(`Unsupported entry extension "${extension}". Supported: js, ts, jsx, tsx, vue, svelte.`)
}

function inferFramework(input: { extension: string, source: string, requested: Framework, version: string }): FrameworkSpec {
  const { extension, source, requested, version } = input
  if (requested !== 'auto') return { name: requested, version }
  if (extension === '.vue') return { name: 'vue', version }
  if (extension === '.svelte') return { name: 'svelte', version }
  if (/\bfrom\s+['"]solid-js\b|\bfrom\s+['"]solid-js\/web\b|\bsolid-js\b/.test(source)) return { name: 'solid', version }
  if (/\bfrom\s+['"]preact\b|\bfrom\s+['"]preact\/compat\b|\bfrom\s+['"]preact\/hooks\b/.test(source)) return { name: 'preact', version }
  if (/\bfrom\s+['"]vue\b/.test(source)) return { name: 'vue', version }
  if (/\bfrom\s+['"]svelte\b|\bfrom\s+['"]svelte\//.test(source)) return { name: 'svelte', version }
  if (extension === '.jsx' || extension === '.tsx') return { name: 'react', version }
  return { name: 'vanilla', version: 'local' }
}

function validateCombination(input: { mode: EntryMode, framework: Framework, extension: string }): void {
  const { mode, framework, extension } = input
  if (mode === 'component' && framework === 'vanilla') {
    throw new Error(`Component entry ${extension} needs a framework. Try --framework react, vue, svelte, preact, or solid.`)
  }
  if (extension === '.vue' && framework !== 'vue') {
    throw new Error('.vue entries must use --framework vue.')
  }
  if (extension === '.svelte' && framework !== 'svelte') {
    throw new Error('.svelte entries must use --framework svelte.')
  }
}

async function createWorkspace(input: { entry: string, mode: EntryMode, framework: FrameworkName }): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'vitepad-'))
  const srcDir = path.join(workspace, 'src')
  await fs.mkdir(srcDir, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(workspace, 'index.html'), htmlTemplate()),
    fs.writeFile(path.join(srcDir, 'style.css'), '@import "tailwindcss";\n'),
    fs.writeFile(path.join(srcDir, 'main.js'), mainTemplate(input)),
  ])
  return workspace
}

function htmlTemplate(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>vitepad</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`
}

function mainTemplate(input: { entry: string, mode: EntryMode, framework: FrameworkName }): string {
  const { entry, mode, framework } = input
  const importPath = `/@fs/${normalizePath(entry)}`
  if (mode === 'main') {
    return `import './style.css'\nimport ${JSON.stringify(importPath)}\n`
  }

  switch (framework) {
    case 'react':
      return `import './style.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from ${JSON.stringify(importPath)}

createRoot(document.getElementById('root')).render(React.createElement(App))
`
    case 'preact':
      return `import './style.css'
import { h, render } from 'preact'
import App from ${JSON.stringify(importPath)}

render(h(App, null), document.getElementById('root'))
`
    case 'solid':
      return `import './style.css'
import { render } from 'solid-js/web'
import App from ${JSON.stringify(importPath)}

render(() => App({}), document.getElementById('root'))
`
    case 'vue':
      return `import './style.css'
import { createApp } from 'vue'
import App from ${JSON.stringify(importPath)}

createApp(App).mount('#root')
`
    case 'svelte':
      return `import './style.css'
import { mount } from 'svelte'
import App from ${JSON.stringify(importPath)}

const target = document.getElementById('root')
const app = mount(App, { target })
export default app
`
    case 'vanilla':
      throw new Error('Vanilla entries cannot be used as component entries.')
  }
}

async function loadUserConfig(configFile: string | undefined): Promise<UserConfig> {
  if (!configFile) return {}
  const resolved = path.resolve(process.cwd(), configFile)
  const configModule = await import(pathToFileURL(resolved).href)
  return configModule.default ?? configModule
}

async function loadPlugins(framework: ResolvedFramework): Promise<PluginOption[]> {
  const [{ default: tailwindcss }, frameworkPlugins] = await Promise.all([
    import('@tailwindcss/vite'),
    loadFrameworkPlugins(framework),
  ])
  const plugins: PluginOption[] = []
  appendPlugin(plugins, tailwindcss())
  plugins.push(...frameworkPlugins)
  return plugins
}

function helpText(prefix?: string): string {
  return `${prefix ? `${prefix}\n\n` : ''}Usage:
  vitepad <entry> [options]

Entries:
  .js, .ts                  Treated as main entry files.
  .jsx, .tsx, .vue, .svelte Treated as App component files.

Options:
  -f, --framework <name>    auto, react, preact, solid, vue, svelte, vanilla
                            Version specs are supported, e.g. react@18, vue@3.4.
  --force-install           Reinstall the selected framework cache.
  -p, --port <number>       Dev server port. Default: 8000
  --host <host>             Dev server host. Default: 0.0.0.0
  --no-open                 Do not open the browser automatically.
  -c, --config <file>       Merge an extra Vite config file.
  -h, --help                Show help.
`
}
