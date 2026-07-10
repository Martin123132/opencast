import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  configureRuntimeEnvironment,
  getDefaultDataRoot,
  resolveWebRoot,
  shouldOpenBrowser,
} from '../server/runtime.ts'

test('portable Windows package is wired as a self-contained D-drive build', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    bin?: string
    scripts?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const packageConfig = await readFile('pkg.config.mjs', 'utf8')
  const packageCompiler = await readFile('tsconfig.package.json', 'utf8')
  const packageScript = await readFile('scripts/package-windows.ts', 'utf8')
  const smokeScript = await readFile('scripts/smoke-windows-package.ts', 'utf8')
  const startHere = await readFile('packaging/START-HERE.txt', 'utf8')
  const readme = await readFile('README.md', 'utf8')
  const gitignore = await readFile('.gitignore', 'utf8')

  assert.equal(packageJson.bin, '.package/server/index.js')
  assert.equal(
    packageJson.scripts?.['package:windows'],
    'tsx scripts/package-windows.ts && tsx scripts/smoke-windows-package.ts',
  )
  assert.equal(
    packageJson.scripts?.['test:package:windows'],
    'tsx scripts/smoke-windows-package.ts',
  )
  assert.ok(packageJson.devDependencies?.['@yao-pkg/pkg'])

  for (const fragment of [
    "assets: ['dist/**/*']",
    "compress: 'Brotli'",
    'sea: true',
    "targets: ['node24-win-x64']",
  ]) {
    assert.ok(packageConfig.includes(fragment), `Package config should include: ${fragment}`)
  }

  for (const fragment of [
    '"module": "NodeNext"',
    '"outDir": ".package"',
    '"server/**/*.ts"',
    '"scripts/path-guards.ts"',
  ]) {
    assert.ok(packageCompiler.includes(fragment), `Package compiler should include: ${fragment}`)
  }

  for (const fragment of [
    'assertDDrivePath',
    'PKG_CACHE_PATH',
    "'ShareFrame.exe'",
    "'LICENSE'",
    "'COMMERCIAL-LICENSE.md'",
    "'SHA256SUMS.txt'",
    "'tar.exe'",
  ]) {
    assert.ok(packageScript.includes(fragment), `Package builder should include: ${fragment}`)
  }

  for (const fragment of [
    'OPENCAST_OPEN_BROWSER',
    'waitForHealth',
    '/api/health',
    'Packaged ShareFrame smoke test passed',
  ]) {
    assert.ok(smokeScript.includes(fragment), `Package smoke test should include: ${fragment}`)
  }

  for (const fragment of [
    'No account is required.',
    'D:\\ShareFrame\\data',
    'D:\\ShareFrame\\temp',
    'glyn@twohandsnetwork.co.uk',
  ]) {
    assert.ok(startHere.includes(fragment), `Package instructions should include: ${fragment}`)
  }

  for (const fragment of [
    'npm.cmd run package:windows',
    'needs no Node.js or npm installation',
    'Current development packages are unsigned.',
  ]) {
    assert.ok(readme.includes(fragment), `README should document package behavior: ${fragment}`)
  }

  assert.match(gitignore, /^\.package$/m)
  assert.match(gitignore, /^release$/m)
})

test('packaged runtime uses D-drive defaults and opens the browser by default', () => {
  const previousTemp = process.env.TEMP
  const previousTmp = process.env.TMP
  const previousOpenBrowser = process.env.OPENCAST_OPEN_BROWSER

  try {
    delete process.env.OPENCAST_OPEN_BROWSER
    assert.equal(getDefaultDataRoot(true), 'D:\\ShareFrame\\data')
    assert.equal(configureRuntimeEnvironment(true), 'D:\\ShareFrame\\temp')
    assert.equal(process.env.TEMP, 'D:\\ShareFrame\\temp')
    assert.equal(process.env.TMP, 'D:\\ShareFrame\\temp')
    assert.equal(shouldOpenBrowser(true), true)
    assert.equal(shouldOpenBrowser(false), false)

    process.env.OPENCAST_OPEN_BROWSER = '0'
    assert.equal(shouldOpenBrowser(true), false)

    assert.equal(
      resolveWebRoot('D:\\open-source\\opencast\\server', false),
      'D:\\open-source\\opencast\\dist',
    )
    assert.equal(
      resolveWebRoot('D:\\open-source\\opencast\\.package\\server', true),
      'D:\\open-source\\opencast\\dist',
    )
  } finally {
    restoreEnvironment('TEMP', previousTemp)
    restoreEnvironment('TMP', previousTmp)
    restoreEnvironment('OPENCAST_OPEN_BROWSER', previousOpenBrowser)
  }
})

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}
