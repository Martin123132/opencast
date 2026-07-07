import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import net from 'node:net'
import { test } from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

test('Windows launcher command is wired for D-drive local startup', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    scripts?: Record<string, string>
  }
  const readme = await readFile('README.md', 'utf8')
  const launcher = await readFile('scripts/start-shareframe.ps1', 'utf8')
  const commandLauncher = await readFile('scripts/start-shareframe.cmd', 'utf8')

  assert.equal(packageJson.scripts?.['start:local'], 'tsx server/index.ts')
  assert.equal(
    packageJson.scripts?.['start:windows'],
    'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-shareframe.ps1',
  )

  for (const fragment of [
    'npm.cmd run start:windows',
    'scripts\\start-shareframe.cmd',
    'D:\\open-source\\opencast-data',
    'next free local port',
    'no account required',
    'private until shared',
    'OPENCAST_DATA_ROOT',
    '-DryRun',
  ]) {
    assert.ok(readme.includes(fragment), `README should document launcher behavior: ${fragment}`)
  }

  for (const fragment of [
    'Resolve-DDrivePath',
    'OPENCAST_DATA_ROOT',
    'npm_config_cache',
    'Resolve-FreePort',
    'Write-LauncherHeader',
    'No account required. Recordings stay on this machine.',
    'Private until you create a guest link',
    'Dry run complete',
    'Start-Process $appUrl',
    "Invoke-Npm -Arguments @('run', 'start:local')",
  ]) {
    assert.ok(launcher.includes(fragment), `Launcher should include: ${fragment}`)
  }

  for (const fragment of [
    '@echo off',
    'cd /d "%~dp0.."',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-shareframe.ps1" %*',
    'ShareFrame stopped with exit code',
  ]) {
    assert.ok(commandLauncher.includes(fragment), `Command launcher should include: ${fragment}`)
  }
})

test(
  'Windows launcher dry-run chooses the next free local port when the preferred port is busy',
  { skip: process.platform !== 'win32' },
  async () => {
    const { server: busyServer, port: busyPort } = await listenOnFirstFreePort(43_000, 43_100)
    const dataRoot = 'D:\\open-source\\.temp\\opencast-launcher-port-test'

    try {
      const { stdout } = await execFileAsync(
        'powershell',
        [
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          'scripts/start-shareframe.ps1',
          '-DataRoot',
          dataRoot,
          '-Port',
          String(busyPort),
          '-NoBrowser',
          '-SkipInstall',
          '-SkipBuild',
          '-DryRun',
        ],
        {
          env: {
            ...process.env,
            TEMP: 'D:\\open-source\\.temp',
            TMP: 'D:\\open-source\\.temp',
            npm_config_cache: 'D:\\open-source\\.cache\\npm',
          },
          timeout: 20_000,
        },
      )

      assert.match(stdout, new RegExp(`Port ${busyPort} is busy\\. ShareFrame will use \\d+ instead\\.`))
      assert.match(stdout, /ShareFrame local launcher/)
      assert.match(stdout, /No account required\. Recordings stay on this machine\./)
      assert.match(stdout, /ShareFrame access:\s+Private until you create a guest link/)
      assert.match(stdout, /Dry run complete\. No install, build, browser, or server start was run\./)
      assert.match(stdout, new RegExp(`ShareFrame storage:\\s+${escapeRegExp(dataRoot)}`))

      const selectedPort = /ShareFrame app:\s+http:\/\/127\.0\.0\.1:(\d+)\//.exec(stdout)?.[1]
      assert.ok(selectedPort, `Expected launcher output to include selected app port:\n${stdout}`)
      assert.notEqual(Number(selectedPort), busyPort)
      assert.ok(Number(selectedPort) > busyPort)
      assert.ok(Number(selectedPort) <= busyPort + 20)
    } finally {
      busyServer.close()
      await rm(dataRoot, { force: true, recursive: true })
    }
  },
)

test('local production server serves the built app shell', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const serverSource = await readFile('server/index.ts', 'utf8')

  assert.ok(packageJson.dependencies?.['@fastify/static'], 'static server dependency should stay installed')

  for (const fragment of [
    "app.register(staticFiles",
    "reply.type('text/html').sendFile('index.html')",
    "request.url.startsWith('/api/')",
    'ShareFrame web build not found',
  ]) {
    assert.ok(serverSource.includes(fragment), `Production server should include: ${fragment}`)
  }
})

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function listenOnFirstFreePort(startPort: number, endPort: number) {
  for (let port = startPort; port <= endPort; port += 1) {
    const server = net.createServer()

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => resolve())
      })

      return { server, port }
    } catch {
      server.close()
    }
  }

  throw new Error(`No free test port found from ${startPort} to ${endPort}`)
}
