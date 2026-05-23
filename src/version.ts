import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export async function packageVersion(): Promise<string> {
  const packageJson = await readPackageJson()
  if (typeof packageJson.version === 'string') return packageJson.version
  throw new Error('Failed to read vitepad version from package.json.')
}

async function readPackageJson(): Promise<Record<string, unknown>> {
  let current = path.dirname(fileURLToPath(import.meta.url))

  while (true) {
    const packageJsonPath = path.join(current, 'package.json')
    const source = await fs.readFile(packageJsonPath, 'utf8').catch(() => null)
    if (source) {
      const packageJson = JSON.parse(source) as Record<string, unknown>
      if (packageJson.name === '@buding0904/vitepad') return packageJson
    }

    const parent = path.dirname(current)
    if (parent === current) {
      throw new Error('Failed to locate vitepad package.json.')
    }
    current = parent
  }
}
