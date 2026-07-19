import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('desktop application and NSIS installer stay wired to the D-drive contract', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    author?: string
    main?: string
    productName?: string
    scripts?: Record<string, string>
    devDependencies?: Record<string, string>
    build?: {
      appId?: string
      directories?: { output?: string }
      nsis?: Record<string, unknown>
      win?: { icon?: string }
    }
  }
  const desktopCompiler = await readFile('tsconfig.desktop.json', 'utf8')
  const installer = await readFile('build/installer.nsh', 'utf8')
  const prepareScript = await readFile('scripts/prepare-desktop.ts', 'utf8')
  const packageScript = await readFile('scripts/package-desktop.ts', 'utf8')
  const smokeScript = await readFile('scripts/smoke-desktop.ts', 'utf8')
  const appStoreDocs = await readFile('packaging/APP_STORE.md', 'utf8')
  const readme = await readFile('README.md', 'utf8')
  const gitignore = await readFile('.gitignore', 'utf8')

  assert.equal(packageJson.productName, 'ShareFrame')
  assert.equal(packageJson.author, 'TWO HANDS NETWORK LTD')
  assert.equal(packageJson.main, '.desktop/desktop/main.js')
  assert.equal(packageJson.scripts?.['desktop:prepare'], 'tsx scripts/prepare-desktop.ts')
  assert.equal(
    packageJson.scripts?.['package:desktop'],
    'tsx scripts/package-desktop.ts && tsx scripts/smoke-desktop.ts',
  )
  assert.equal(packageJson.scripts?.['test:desktop'], 'tsx scripts/smoke-desktop.ts')
  assert.equal(
    packageJson.scripts?.['test:desktop:prepared'],
    'tsx scripts/smoke-desktop.ts --prepared',
  )
  assert.ok(packageJson.devDependencies?.electron)
  assert.ok(packageJson.devDependencies?.['electron-builder'])
  assert.equal(packageJson.build?.appId, 'uk.co.twohandsnetwork.shareframe')
  assert.equal(packageJson.build?.directories?.output, 'release/desktop')
  assert.equal(packageJson.build?.win?.icon, 'build/shareframe.ico')
  assert.equal(
    packageJson.build?.nsis?.artifactName,
    'ShareFrame-${version}-win-x64-Setup.${ext}',
  )
  assert.equal(packageJson.build?.nsis?.oneClick, true)
  assert.equal(packageJson.build?.nsis?.perMachine, false)
  assert.equal(packageJson.build?.nsis?.deleteAppDataOnUninstall, false)

  for (const fragment of [
    '"module": "NodeNext"',
    '"outDir": ".desktop"',
    '"desktop/**/*.ts"',
    '"server/**/*.ts"',
  ]) {
    assert.ok(desktopCompiler.includes(fragment), `Desktop compiler should include: ${fragment}`)
  }

  assert.ok(installer.includes('InstallLocation "D:\\ShareFrame\\App"'))

  for (const fragment of [
    'ELECTRON_CACHE',
    'electron-builder',
    "silentArguments: '/S'",
    "dataRoot: 'D:\\\\ShareFrame\\\\data'",
    "contact: 'glyn@twohandsnetwork.co.uk'",
  ]) {
    assert.ok(packageScript.includes(fragment), `Desktop package builder should include: ${fragment}`)
  }

  for (const fragment of ['sharp', 'pngToIco', 'favicon.svg', 'shareframe.ico']) {
    assert.ok(prepareScript.includes(fragment), `Desktop preparation should include: ${fragment}`)
  }

  for (const fragment of [
    'electron_config_cache',
    "require('electron')",
    'SHAREFRAME_DESKTOP_SMOKE',
    'SHAREFRAME_DESKTOP_SMOKE_RESULT',
    'uiReady',
    'doesNotMatch',
    'Installed-app smoke test passed',
  ]) {
    assert.ok(smokeScript.includes(fragment), `Desktop smoke test should include: ${fragment}`)
  }

  for (const fragment of [
    'schemaVersion',
    'installer.sha256',
    'installer.silentArguments',
    'D:\\ShareFrame\\App',
    'signed',
  ]) {
    assert.ok(appStoreDocs.includes(fragment), `App-store contract should include: ${fragment}`)
  }

  for (const fragment of [
    'npm.cmd run package:desktop',
    'normal Windows desktop application',
    'D:\\ShareFrame\\desktop',
    'app-store manifest',
    'development installers are unsigned',
  ]) {
    assert.ok(readme.includes(fragment), `README should document desktop behavior: ${fragment}`)
  }

  assert.match(gitignore, /^\.desktop$/m)
  assert.match(gitignore, /^build\/shareframe\.ico$/m)
  assert.match(gitignore, /^build\/shareframe\.png$/m)
})

test('desktop shell restricts privileges and guides capture-source consent', async () => {
  const main = await readFile('desktop/main.ts', 'utf8')
  const pickerHtml = await readFile('desktop/picker.html', 'utf8')
  const pickerRenderer = await readFile('desktop/picker-renderer.js', 'utf8')
  const pickerPreload = await readFile('desktop/picker-preload.cjs', 'utf8')

  for (const fragment of [
    "app.setPath('userData'",
    "app.setPath('sessionData'",
    "app.setPath('temp'",
    "app.setPath('crashDumps'",
    'app.setAppLogsPath',
    "appendSwitch('disk-cache-dir'",
    'requestSingleInstanceLock',
    'setPermissionCheckHandler',
    'setPermissionRequestHandler',
    'setDisplayMediaRequestHandler',
    '!request.userGesture',
    'isTrustedOrigin',
    "types: ['screen', 'window']",
    "contextIsolation: true",
    "nodeIntegration: false",
    "sandbox: true",
  ]) {
    assert.ok(main.includes(fragment), `Desktop security contract should include: ${fragment}`)
  }

  assert.ok(pickerHtml.includes('Choose what to record'))
  assert.ok(pickerHtml.includes("default-src 'self'"))
  assert.ok(pickerPreload.includes('contextBridge.exposeInMainWorld'))
  assert.ok(pickerRenderer.includes('textContent'))
  assert.doesNotMatch(pickerRenderer, /innerHTML/)
})
