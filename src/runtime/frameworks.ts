import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { normalizePath, type Alias, type PluginOption } from 'vite'

export type FrameworkName = 'react' | 'preact' | 'solid' | 'vue' | 'svelte' | 'vanilla'
export type Framework = 'auto' | FrameworkName

export interface FrameworkSpec {
  name: Framework
  version: string
}

export interface ResolvedFramework {
  name: FrameworkName
  version: string
  cacheDir?: string
  aliases: Alias[]
}

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)), '..')
const cacheVersion = 'v1'

export async function resolveFramework(spec: FrameworkSpec, options: { forceInstall: boolean }): Promise<ResolvedFramework> {
  if (spec.name === 'auto') {
    throw new Error('Internal error: unresolved framework auto.')
  }
  if (spec.name === 'vanilla') {
    return {
      name: 'vanilla',
      version: 'local',
      aliases: packageAliases(packageNodeModules(), ['tailwindcss']),
    }
  }

  const packages = frameworkPackages(spec.name, spec.version)
  const cacheDir = frameworkCacheDir(spec.name, spec.version)
  const nodeModules = path.join(cacheDir, 'node_modules')

  if (options.forceInstall && await pathExists(cacheDir)) {
    await fs.rm(cacheDir, { recursive: true, force: true })
  }

  if (!await isInstalled(cacheDir, packages)) {
    await installFrameworkCache(cacheDir, packages)
  } else {
    console.log(`vitepad: using cached ${spec.name}@${spec.version}`)
    console.log(`vitepad: cache ${cacheDir}`)
  }

  return {
    name: spec.name,
    version: spec.version,
    cacheDir,
    aliases: [
      ...packageAliases(packageNodeModules(), ['tailwindcss']),
      ...packageAliases(nodeModules, frameworkRuntimePackages(spec.name)),
    ],
  }
}

export function frameworkDedupe(framework: FrameworkName): string[] {
  return frameworkRuntimePackages(framework)
}

export function frameworkOptimizeDeps(framework: FrameworkName): string[] {
  switch (framework) {
    case 'react':
      return ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime']
    case 'preact':
      return ['preact', 'preact/jsx-runtime', 'preact/hooks']
    case 'solid':
      return ['solid-js', 'solid-js/web']
    case 'vue':
      return ['vue']
    case 'svelte':
    case 'vanilla':
      return []
  }
}

export async function loadFrameworkPlugins(framework: ResolvedFramework): Promise<PluginOption[]> {
  if (framework.name === 'vanilla') {
    return []
  }
  if (!framework.cacheDir) {
    throw new Error(`Missing framework cache for ${framework.name}.`)
  }

  const plugins: PluginOption[] = []
  for (const pluginPackage of frameworkPluginPackages(framework.name)) {
    const mod = await importCachePackage(framework.cacheDir, pluginPackage)
    if (pluginPackage === '@sveltejs/vite-plugin-svelte') {
      appendPlugin(plugins, mod.svelte())
    } else {
      appendPlugin(plugins, mod.default())
    }
  }
  return plugins
}

export function appendPlugin(plugins: PluginOption[], plugin: PluginOption): void {
  if (Array.isArray(plugin)) {
    plugins.push(...plugin)
  } else {
    plugins.push(plugin)
  }
}

function frameworkPackages(framework: FrameworkName, version: string): string[] {
  switch (framework) {
    case 'react':
      return [`react@${version}`, `react-dom@${version}`, '@vitejs/plugin-react@latest']
    case 'preact':
      return [`preact@${version}`, '@preact/preset-vite@latest']
    case 'solid':
      return [`solid-js@${version}`, 'vite-plugin-solid@latest']
    case 'vue':
      return [`vue@${version}`, '@vitejs/plugin-vue@latest', '@vitejs/plugin-vue-jsx@latest']
    case 'svelte':
      return [`svelte@${version}`, '@sveltejs/vite-plugin-svelte@latest']
    case 'vanilla':
      return []
  }
}

function frameworkRuntimePackages(framework: FrameworkName): string[] {
  switch (framework) {
    case 'react':
      return ['react', 'react-dom']
    case 'preact':
      return ['preact']
    case 'solid':
      return ['solid-js']
    case 'vue':
      return ['vue']
    case 'svelte':
      return ['svelte']
    case 'vanilla':
      return []
  }
}

function frameworkPluginPackages(framework: FrameworkName): string[] {
  switch (framework) {
    case 'react':
      return ['@vitejs/plugin-react']
    case 'preact':
      return ['@preact/preset-vite']
    case 'solid':
      return ['vite-plugin-solid']
    case 'vue':
      return ['@vitejs/plugin-vue', '@vitejs/plugin-vue-jsx']
    case 'svelte':
      return ['@sveltejs/vite-plugin-svelte']
    case 'vanilla':
      return []
  }
}

function packageAliases(nodeModules: string, packageNames: string[]): Alias[] {
  return packageNames.flatMap((packageName) => [
    {
      find: packageName,
      replacement: path.join(nodeModules, packageName),
    },
    {
      find: new RegExp(`^${escapeRegExp(packageName)}(/.*)$`),
      replacement: `${normalizePath(path.join(nodeModules, packageName))}$1`,
    },
  ])
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function packageNodeModules(): string {
  return path.join(rootDir, 'node_modules')
}

function frameworkCacheDir(framework: FrameworkName, version: string): string {
  const base = process.env.VITEPAD_CACHE_DIR
    || (process.env.XDG_CACHE_HOME ? path.join(process.env.XDG_CACHE_HOME, 'vitepad') : path.join(os.homedir(), '.cache', 'vitepad'))
  return path.join(base, cacheVersion, `${framework}-${sanitizeCacheKey(version)}`)
}

function sanitizeCacheKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

async function isInstalled(cacheDir: string, packages: string[]): Promise<boolean> {
  if (!await pathExists(path.join(cacheDir, 'node_modules'))) return false
  for (const pkg of packages) {
    const { name } = splitPackageSpec(pkg)
    if (!await pathExists(path.join(cacheDir, 'node_modules', name))) {
      return false
    }
  }
  return true
}

async function installFrameworkCache(cacheDir: string, packages: string[]): Promise<void> {
  await fs.mkdir(cacheDir, { recursive: true })
  await fs.writeFile(path.join(cacheDir, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
    dependencies: Object.fromEntries(packages.map((pkg) => packageToDependency(pkg))),
  }, null, 2))

  console.log('vitepad: framework cache miss')
  console.log(`vitepad: cache ${cacheDir}`)
  for (const pkg of packages) {
    console.log(`vitepad: downloading ${pkg}`)
  }

  await runInstall(cacheDir)
}

function runInstall(cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['install', '--no-audit', '--no-fund', '--loglevel=notice'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const progress = createProgress('vitepad: installing framework packages')
    let output = ''

    child.stdout.on('data', (chunk) => {
      output += chunk
      progress.tick()
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
      progress.tick()
    })
    child.on('error', (error) => {
      progress.stop()
      reject(error)
    })
    child.on('exit', (code) => {
      progress.stop()
      if (code === 0) {
        console.log('vitepad: framework packages installed')
        resolve()
      } else {
        reject(new Error(`npm install failed with exit code ${code}\n${output.trim()}`))
      }
    })
  })
}

function createProgress(label: string): { tick: () => void, stop: () => void } {
  const width = 18
  let frame = 0
  const render = () => {
    const position = frame % width
    const bar = Array.from({ length: width }, (_, index) => index === position ? '=' : '-').join('')
    process.stderr.write(`\r${label} [${bar}]`)
    frame += 1
  }
  const timer = setInterval(render, 120)
  render()
  return {
    tick: render,
    stop() {
      clearInterval(timer)
      process.stderr.write(`\r${' '.repeat(label.length + width + 4)}\r`)
    },
  }
}

function packageToDependency(pkg: string): [string, string] {
  const parsed = splitPackageSpec(pkg)
  return [parsed.name, parsed.version]
}

function splitPackageSpec(spec: string): { name: string, version: string } {
  if (spec.startsWith('@')) {
    const secondAt = spec.indexOf('@', 1)
    if (secondAt === -1) return { name: spec, version: 'latest' }
    return { name: spec.slice(0, secondAt), version: spec.slice(secondAt + 1) }
  }
  const at = spec.indexOf('@')
  if (at === -1) return { name: spec, version: 'latest' }
  return { name: spec.slice(0, at), version: spec.slice(at + 1) }
}

async function importCachePackage(cacheDir: string, packageName: string): Promise<Record<string, any>> {
  const requireFromCache = createRequire(path.join(cacheDir, 'package.json'))
  const resolved = requireFromCache.resolve(packageName)
  return import(pathToFileURL(resolved).href)
}

async function pathExists(file: string): Promise<boolean> {
  return fs.access(file).then(() => true, () => false)
}
