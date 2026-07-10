import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertDDrivePath } from './path-guards.js'
import { resolveFreePort } from '../server/runtime.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')) as {
  version: string
}
const executablePath = path.join(
  repoRoot,
  'release',
  `ShareFrame-${packageJson.version}-win-x64`,
  'ShareFrame.exe',
)
const smokeRoot = assertDDrivePath(
  path.join(path.dirname(repoRoot), '.temp', 'shareframe-package-smoke'),
  'Package smoke root',
)
const dataRoot = path.join(smokeRoot, 'data')
const runtimeTemp = path.join(smokeRoot, 'temp')
const port = await resolveFreePort('127.0.0.1', 43_500)
const appUrl = `http://127.0.0.1:${port}`

await rm(smokeRoot, { force: true, recursive: true })
await mkdir(runtimeTemp, { recursive: true })

const output: string[] = []
const child = spawn(executablePath, [], {
  cwd: smokeRoot,
  env: {
    ...process.env,
    OPENCAST_DATA_ROOT: dataRoot,
    OPENCAST_HOST: '127.0.0.1',
    OPENCAST_OPEN_BROWSER: '0',
    OPENCAST_PORT: String(port),
    TEMP: runtimeTemp,
    TMP: runtimeTemp,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})

child.stdout.on('data', (chunk) => output.push(String(chunk)))
child.stderr.on('data', (chunk) => output.push(String(chunk)))

try {
  const health = await waitForHealth(`${appUrl}/api/health`, child, output)
  assert.equal(health.ok, true)
  assert.equal(health.dataRoot, dataRoot)

  const appShell = await fetch(appUrl)
  assert.equal(appShell.status, 200)
  assert.match(await appShell.text(), /ShareFrame/)

  process.stdout.write(`Packaged ShareFrame smoke test passed at ${appUrl}.\n`)
} finally {
  child.kill()
  await waitForExit(child)
  await rm(smokeRoot, { force: true, recursive: true })
}

async function waitForHealth(
  url: string,
  processHandle: ReturnType<typeof spawn>,
  output: string[],
) {
  const deadline = Date.now() + 30_000

  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`ShareFrame.exe exited before startup.\n${output.join('')}`)
    }

    try {
      const response = await fetch(url)

      if (response.ok) {
        return (await response.json()) as { ok: boolean; dataRoot: string }
      }
    } catch {
      // The server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  throw new Error(`Timed out waiting for packaged ShareFrame.\n${output.join('')}`)
}

function waitForExit(processHandle: ReturnType<typeof spawn>) {
  if (processHandle.exitCode !== null) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 5_000)
    processHandle.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}
