import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('Windows launcher command is wired for D-drive local startup', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    scripts?: Record<string, string>
  }
  const readme = await readFile('README.md', 'utf8')
  const launcher = await readFile('scripts/start-shareframe.ps1', 'utf8')

  assert.equal(packageJson.scripts?.['start:local'], 'tsx server/index.ts')
  assert.equal(
    packageJson.scripts?.['start:windows'],
    'powershell -ExecutionPolicy Bypass -File scripts/start-shareframe.ps1',
  )

  for (const fragment of [
    'npm.cmd run start:windows',
    'D:\\open-source\\opencast-data',
    'next free local port',
    'OPENCAST_DATA_ROOT',
  ]) {
    assert.ok(readme.includes(fragment), `README should document launcher behavior: ${fragment}`)
  }

  for (const fragment of [
    'Resolve-DDrivePath',
    'OPENCAST_DATA_ROOT',
    'npm_config_cache',
    'Resolve-FreePort',
    'Start-Process $appUrl',
    "Invoke-Npm -Arguments @('run', 'start:local')",
  ]) {
    assert.ok(launcher.includes(fragment), `Launcher should include: ${fragment}`)
  }
})

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
