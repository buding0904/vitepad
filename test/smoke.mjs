import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vitepad-cache-'))

const selected = new Set((process.env.SMOKE_CASES || '').split(',').map((item) => item.trim()).filter(Boolean))
const cases = [
  {
    name: 'main ts',
    file: 'main.ts',
    source: 'document.querySelector("#root").textContent = "Main TS"',
    args: [],
  },
  {
    name: 'react component',
    file: 'src/App.tsx',
    source: 'export default function App() { return <main className="p-4">React</main> }',
    args: ['--framework', 'react@18'],
    editorLinks: ['react', 'react-dom', '@types/react', '@types/react-dom'],
  },
  {
    name: 'preact component',
    file: 'App.tsx',
    source: 'export default function App() { return <main className="p-4">Preact</main> }',
    args: ['--framework', 'preact@10'],
  },
  {
    name: 'solid component',
    file: 'App.tsx',
    source: 'export default function App() { return <main class="p-4">Solid</main> }',
    args: ['--framework', 'solid@1'],
  },
  {
    name: 'vue component',
    file: 'App.vue',
    source: '<template><main class="p-4">Vue</main></template>',
    args: ['--framework', 'vue@3'],
  },
  {
    name: 'svelte component',
    file: 'App.svelte',
    source: '<main class="p-4">Svelte</main>',
    args: ['--framework', 'svelte@5'],
  },
].filter((item) => selected.size === 0 || selected.has(item.name))

try {
  for (const item of cases) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vitepad-smoke-'))
    const entry = path.join(dir, item.file)
    await fs.mkdir(path.dirname(entry), { recursive: true })
    await fs.writeFile(entry, item.source)
    await runCase(item.name, entry, item.args)
    await assertEditorLinks(item.name, path.dirname(entry), item.editorLinks || [])
    console.log(`smoke ok: ${item.name}`)
  }

  console.log('smoke ok')
} finally {
  await fs.rm(cacheRoot, { recursive: true, force: true })
}

/**
 * @param {string} name
 * @param {string} dir
 * @param {string[]} links
 * @returns {Promise<void>}
 */
async function assertEditorLinks(name, dir, links) {
  for (const link of links) {
    const target = path.join(dir, 'node_modules', link)
    const stat = await fs.lstat(target).catch(() => null)
    if (!stat?.isSymbolicLink()) {
      throw new Error(`${name} missing editor link: ${target}`)
    }
  }
}

/**
 * @param {string} name
 * @param {string} entry
 * @param {string[]} args
 * @returns {Promise<void>}
 */
function runCase(name, entry, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(root, 'dist/cli.js'),
      entry,
      '--port',
      '0',
      '--host',
      '127.0.0.1',
      '--no-open',
      ...args,
    ], {
      cwd: root,
      env: {
        ...process.env,
        VITEPAD_CACHE_DIR: cacheRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''
    let ready = false
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`${name} timed out\n${output}`))
    }, 120000)

    const onOutput = (chunk) => {
      output += chunk
      if (output.includes('vitepad ready')) {
        ready = true
        clearTimeout(timer)
        child.kill('SIGTERM')
        resolve()
      }
    }

    child.stdout.on('data', onOutput)
    child.stderr.on('data', onOutput)
    child.on('exit', (code) => {
      if (!ready) {
        clearTimeout(timer)
        reject(new Error(`${name} exited with ${code}\n${output}`))
      }
    })
  })
}
