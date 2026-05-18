import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { type Alias, type PluginOption } from 'vite'
import pc from 'picocolors'

export type FrameworkName = 'react' | 'preact' | 'solid' | 'vue' | 'svelte' | 'vanilla'
export type Framework = 'auto' | FrameworkName

export interface FrameworkSpec {
  name: Framework
  version: string
}

export interface ResolvedFramework {
  name: FrameworkName
  version: string
  requested: string
  cacheStatus: 'hit' | 'miss' | 'local'
  cacheDir?: string
  aliases: Alias[]
  packageLinks: PackageLink[]
}

export interface PackageLink {
  name: string
  source: string
}

const packageRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const requireFromPackage = createRequire(path.join(packageRoot, 'package.json'))
const linkedPeerPackages = ['vite']
const log = {
  framework(requested: string, resolved: string) {
    console.log(`\n${pc.cyan('vitepad')} ${pc.bold('framework')} ${pc.gray(requested)} ${pc.gray('->')} ${pc.green(resolved)}`)
  },
  install(packages: string[]) {
    console.log(`  ${pc.gray('install')} ${packages.map((pkg) => pc.cyan(pkg)).join(pc.gray(', '))}`)
  },
  done(message: string) {
    console.log(`  ${pc.green(message)}`)
  },
}

export async function resolveFramework(spec: FrameworkSpec, options: { forceInstall: boolean }): Promise<ResolvedFramework> {
  if (spec.name === 'auto') {
    throw new Error('Internal error: unresolved framework auto.')
  }
  if (spec.name === 'vanilla') {
    return {
      name: 'vanilla',
      version: 'local',
      requested: 'vanilla',
      cacheStatus: 'local',
      aliases: [],
      packageLinks: packageLinks(['tailwindcss']),
    }
  }

  const resolved = await resolveFrameworkPackages(spec.name, spec.version)
  const cacheDir = frameworkCacheDir(spec.name, resolved.version)
  const nodeModules = path.join(cacheDir, 'node_modules')
  const installed = await isInstalled(cacheDir, resolved.packages)

  if (options.forceInstall && await pathExists(cacheDir)) {
    await fs.rm(cacheDir, { recursive: true, force: true })
  }

  log.framework(`${spec.name}@${spec.version}`, `${spec.name}@${resolved.version}`)
  const cacheStatus = options.forceInstall ? 'miss' : installed ? 'hit' : 'miss'

  if (options.forceInstall || !installed) {
    log.install(resolved.packages)
    await installFrameworkCache(cacheDir, resolved.packages)
  }
  await linkPeerPackages(cacheDir)

  return {
    name: spec.name,
    version: resolved.version,
    requested: `${spec.name}@${spec.version}`,
    cacheStatus,
    cacheDir,
    aliases: [],
    packageLinks: [
      ...packageLinks(['tailwindcss']),
      ...packageLinks(nodeModules, frameworkRuntimePackages(spec.name)),
    ],
  }
}

async function resolveFrameworkPackages(framework: FrameworkName, version: string): Promise<{ version: string, packages: string[] }> {
  const specs = frameworkPackageSpecs(framework, version)
  const resolved = await Promise.all(specs.map(async (spec) => {
    const parsed = splitPackageSpec(spec)
    const resolvedVersion = await resolvePackageVersion(parsed.name, parsed.version)
    return {
      name: parsed.name,
      version: resolvedVersion,
      spec: `${parsed.name}@${resolvedVersion}`,
    }
  }))
  const primary = splitPackageSpec(specs[0]).name
  const primaryVersion = resolved.find((pkg) => pkg.name === primary)?.version
  if (!primaryVersion) {
    throw new Error(`Failed to resolve ${framework}@${version}.`)
  }
  return {
    version: primaryVersion,
    packages: resolved.map((pkg) => pkg.spec),
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
    appendPlugin(plugins, createFrameworkPlugin(pluginPackage, mod))
  }
  return plugins
}

function createFrameworkPlugin(pluginPackage: string, mod: Record<string, any>): PluginOption {
  const factory = frameworkPluginFactory(pluginPackage, mod)
  return factory()
}

function frameworkPluginFactory(pluginPackage: string, mod: Record<string, any>): () => PluginOption {
  if (pluginPackage === '@sveltejs/vite-plugin-svelte' && typeof mod.svelte === 'function') {
    return mod.svelte
  }
  if (pluginPackage === '@preact/preset-vite' && typeof mod.preact === 'function') {
    return mod.preact
  }
  if (typeof mod.default === 'function') {
    return mod.default
  }
  if (mod.default && typeof mod.default.default === 'function') {
    return mod.default.default
  }

  throw new Error(`Failed to load Vite plugin ${pluginPackage}: no callable plugin export found.`)
}

export function appendPlugin(plugins: PluginOption[], plugin: PluginOption): void {
  if (Array.isArray(plugin)) {
    plugins.push(...plugin)
  } else {
    plugins.push(plugin)
  }
}

function frameworkPackageSpecs(framework: FrameworkName, version: string): string[] {
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

function resolvePackageVersion(name: string, range: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['view', `${name}@${range}`, 'version', '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`npm view failed for ${name}@${range}\n${stderr.trim()}`))
        return
      }

      try {
        const parsed = JSON.parse(stdout.trim())
        const version = Array.isArray(parsed) ? parsed[parsed.length - 1] : parsed
        if (typeof version !== 'string' || !version) {
          throw new Error(`Unexpected npm view output: ${stdout}`)
        }
        resolve(version)
      } catch (error) {
        reject(error)
      }
    })
  })
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

function packageLinks(packageNames: string[]): PackageLink[]
function packageLinks(nodeModules: string, packageNames: string[]): PackageLink[]
function packageLinks(nodeModulesOrPackageNames: string | string[], maybePackageNames?: string[]): PackageLink[] {
  if (Array.isArray(nodeModulesOrPackageNames)) {
    return nodeModulesOrPackageNames.map((packageName) => ({
      name: packageName,
      source: resolveInstalledPackageDir(packageName),
    }))
  }

  const nodeModules = nodeModulesOrPackageNames
  const packageNames = maybePackageNames ?? []
  return packageNames.map((packageName) => ({
    name: packageName,
    source: path.join(nodeModules, packageName),
  }))
}

function resolveInstalledPackageDir(packageName: string): string {
  const packageJson = requireFromPackage.resolve(`${packageName}/package.json`)
  return path.dirname(packageJson)
}

function frameworkCacheDir(framework: FrameworkName, version: string): string {
  const base = process.env.VITEPAD_CACHE_DIR
    || (process.env.XDG_CACHE_HOME ? path.join(process.env.XDG_CACHE_HOME, 'vitepad') : path.join(os.homedir(), '.cache', 'vitepad'))
  return path.join(base, 'frameworks', `${framework}-${sanitizeCacheKey(version)}`)
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

  await runInstall(cacheDir)
}

function runInstall(cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['install', '--legacy-peer-deps', '--no-audit', '--no-fund', '--loglevel=notice'], {
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
        log.done('install complete')
        resolve()
      } else {
        reject(new Error(`npm install failed with exit code ${code}\n${output.trim()}`))
      }
    })
  })
}

async function linkPeerPackages(cacheDir: string): Promise<void> {
  await fs.mkdir(path.join(cacheDir, 'node_modules'), { recursive: true })
  for (const packageName of linkedPeerPackages) {
    try {
      await linkPackage({
        source: resolveInstalledPackageDir(packageName),
        target: path.join(cacheDir, 'node_modules', packageName),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to link ${packageName} into vitepad cache at ${cacheDir}.\n${message}`)
    }
  }
}

async function linkPackage(input: { source: string, target: string }): Promise<void> {
  const source = await fs.realpath(input.source)
  const existing = await fs.lstat(input.target).catch(() => null)

  if (existing) {
    if (existing.isSymbolicLink()) {
      const current = await fs.realpath(input.target).catch(() => null)
      if (current === source) return
    }
    await fs.rm(input.target, { recursive: true, force: true })
  }

  await fs.symlink(source, input.target, 'dir')
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
