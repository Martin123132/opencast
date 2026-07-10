import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { assertDDrivePath } from '../scripts/path-guards.js'

const packagedDataRoot = 'D:\\ShareFrame\\data'
const packagedTempRoot = 'D:\\ShareFrame\\temp'

type ProcessWithPkg = NodeJS.Process & {
  pkg?: unknown
}

export function isPackagedRuntime() {
  return Boolean((process as ProcessWithPkg).pkg)
}

export function getDefaultDataRoot(packaged = isPackagedRuntime()) {
  return packaged ? packagedDataRoot : 'D:\\open-source\\opencast-data'
}

export function configureRuntimeEnvironment(packaged = isPackagedRuntime()) {
  if (!packaged) {
    return null
  }

  const tempRoot = assertDDrivePath(packagedTempRoot, 'ShareFrame temp root')
  process.env.TEMP = tempRoot
  process.env.TMP = tempRoot

  return tempRoot
}

export async function ensureRuntimeTempDirectory(tempRoot: string | null) {
  if (tempRoot) {
    await mkdir(tempRoot, { recursive: true })
  }
}

export function resolveWebRoot(moduleDirectory: string, packaged = isPackagedRuntime()) {
  const rootOffset = packaged ? ['..', '..'] : ['..']
  return path.resolve(moduleDirectory, ...rootOffset, 'dist')
}

export async function resolveFreePort(host: string, preferredPort: number, attempts = 21) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const candidate = preferredPort + offset

    if (await canListen(host, candidate)) {
      return candidate
    }
  }

  throw new Error(
    `No free local port found from ${preferredPort} to ${preferredPort + attempts - 1}.`,
  )
}

export function shouldOpenBrowser(packaged = isPackagedRuntime()) {
  const override = process.env.OPENCAST_OPEN_BROWSER?.trim().toLowerCase()

  if (override) {
    return !['0', 'false', 'no', 'off'].includes(override)
  }

  return packaged
}

export function openBrowser(appUrl: string) {
  const command = getBrowserCommand(appUrl)

  if (!command) {
    return false
  }

  const child = spawn(command.file, command.arguments, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.once('error', (error) => {
    process.stderr.write(`ShareFrame could not open the browser automatically: ${error.message}\n`)
  })
  child.unref()
  return true
}

function canListen(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer()

    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, host)
  })
}

function getBrowserCommand(appUrl: string) {
  if (process.platform === 'win32') {
    return {
      file: 'cmd.exe',
      arguments: ['/d', '/s', '/c', 'start', '', appUrl],
    }
  }

  if (process.platform === 'darwin') {
    return { file: 'open', arguments: [appUrl] }
  }

  if (process.platform === 'linux') {
    return { file: 'xdg-open', arguments: [appUrl] }
  }

  return null
}
