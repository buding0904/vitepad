#!/usr/bin/env node
import { packageVersion } from './version.js'

const argv = process.argv.slice(2)
const runtimeEntry = './cli-runtime.js'

if (argv.includes('-v') || argv.includes('--version')) {
  packageVersion()
    .then((version) => {
      console.log(version)
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    })
} else {
  import(runtimeEntry)
    .catch(handleError)
}

function handleError(error: unknown): void {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
