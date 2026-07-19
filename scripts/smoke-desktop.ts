import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertDDrivePath } from './path-guards.js'
import { resolveFreePort } from '../server/runtime.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const usePreparedDesktop = process.argv.includes('--prepared')
const electronCache = assertDDrivePath(
  path.join(path.dirname(repoRoot), '.cache', 'electron'),
  'Electron cache',
)
process.env.ELECTRON_CACHE ??= electronCache
process.env.electron_config_cache ??= electronCache

const require = createRequire(import.meta.url)
const executablePath = usePreparedDesktop
  ? String(require('electron'))
  : path.join(repoRoot, 'release', 'desktop', 'win-unpacked', 'ShareFrame.exe')
const executableArguments = usePreparedDesktop ? [repoRoot] : []
const smokeRoot = assertDDrivePath(
  path.join(path.dirname(repoRoot), '.temp', 'shareframe-desktop-smoke'),
  'Desktop smoke root',
)
const resultPath = path.join(smokeRoot, 'result.json')
const dataRoot = path.join(smokeRoot, 'data')
const desktopRoot = path.join(smokeRoot, 'desktop')
const runtimeTemp = path.join(smokeRoot, 'temp')
const port = await resolveFreePort('127.0.0.1', 43_700)

await rm(smokeRoot, { force: true, recursive: true })
await mkdir(runtimeTemp, { recursive: true })

const output: string[] = []
const child = spawn(executablePath, executableArguments, {
  cwd: smokeRoot,
  env: {
    ...process.env,
    OPENCAST_DATA_ROOT: dataRoot,
    OPENCAST_PORT: String(port),
    SHAREFRAME_DESKTOP_ROOT: desktopRoot,
    SHAREFRAME_DESKTOP_SMOKE: '1',
    SHAREFRAME_DESKTOP_SMOKE_RESULT: resultPath,
    TEMP: runtimeTemp,
    TMP: runtimeTemp,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})

child.stdout.on('data', (chunk) => output.push(String(chunk)))
child.stderr.on('data', (chunk) => output.push(String(chunk)))

try {
  const result = await waitForResult(resultPath, child, output)
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'desktop')
  assert.equal(result.title, 'ShareFrame')
  assert.equal(result.uiReady, true)
  assert.equal(result.dataRoot, dataRoot)
  assert.equal(result.desktopRoot, desktopRoot)
  assert.doesNotMatch(JSON.stringify(result), /\bC:[\\/]/i)
  await waitForExit(child, output)
  process.stdout.write(`Installed-app smoke test passed with D-drive state at ${smokeRoot}.\n`)
} finally {
  if (child.exitCode === null) {
    child.kill()
    await waitForExit(child, output, false)
  }
  await rm(smokeRoot, { force: true, recursive: true })
}

async function waitForResult(
  filePath: string,
  processHandle: ReturnType<typeof spawn>,
  output: string[],
) {
  const deadline = Date.now() + 45_000

  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`ShareFrame desktop app exited before readiness.\n${output.join('')}`)
    }

    try {
      return JSON.parse(await readFile(filePath, 'utf8')) as {
        dataRoot: string
        desktopRoot: string
        mode: string
        ok: boolean
        title: string
        uiReady: boolean
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }

  throw new Error(`Timed out waiting for ShareFrame desktop readiness.\n${output.join('')}`)
}

function waitForExit(
  processHandle: ReturnType<typeof spawn>,
  output: string[],
  requireCleanExit = true,
) {
  if (processHandle.exitCode !== null) {
    if (requireCleanExit) {
      assert.equal(processHandle.exitCode, 0, output.join(''))
    }
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Desktop app did not exit.\n${output.join('')}`)), 10_000)
    processHandle.once('exit', (exitCode) => {
      clearTimeout(timeout)
      if (requireCleanExit && exitCode !== 0) {
        reject(new Error(`Desktop app exited with code ${exitCode}.\n${output.join('')}`))
        return
      }
      resolve()
    })
  })
}
