import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertDDrivePath } from './path-guards.js'
import { prepareDesktopBuild } from './prepare-desktop.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = path.dirname(repoRoot)
const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')) as {
  version: string
}
const releaseRoot = assertDDrivePath(path.join(repoRoot, 'release', 'desktop'), 'Desktop release root')
const tempRoot = assertDDrivePath(path.join(workspaceRoot, '.temp'), 'Desktop package temp root')
const npmCache = assertDDrivePath(path.join(workspaceRoot, '.cache', 'npm'), 'npm cache')
const electronCache = assertDDrivePath(
  path.join(workspaceRoot, '.cache', 'electron'),
  'Electron cache',
)
const electronBuilderCache = assertDDrivePath(
  path.join(workspaceRoot, '.cache', 'electron-builder'),
  'Electron Builder cache',
)

if (process.platform !== 'win32') {
  throw new Error('ShareFrame desktop packaging must run on Windows.')
}

for (const directory of [tempRoot, npmCache, electronCache, electronBuilderCache]) {
  await mkdir(directory, { recursive: true })
}

Object.assign(process.env, {
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  ELECTRON_BUILDER_CACHE: electronBuilderCache,
  ELECTRON_CACHE: electronCache,
  TEMP: tempRoot,
  TMP: tempRoot,
  npm_config_cache: npmCache,
})

await removeGeneratedRelease(releaseRoot)
await prepareDesktopBuild()
await runCommand(process.execPath, [
  path.join(repoRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'),
  '--win',
  'nsis',
  '--x64',
  '--publish',
  'never',
])

const installerPath = await findInstaller(releaseRoot)
const installerStats = await stat(installerPath)
const installerChecksum = await sha256(installerPath)
const checksumPath = `${installerPath}.sha256`
const manifestPath = path.join(
  releaseRoot,
  `ShareFrame-${packageJson.version}-win-x64.app.json`,
)

await writeFile(
  checksumPath,
  `${installerChecksum}  ${path.basename(installerPath)}\n`,
  'utf8',
)
await writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      architecture: 'x64',
      channel: 'development',
      id: 'uk.co.twohandsnetwork.shareframe',
      installer: {
        defaultInstallLocation: 'D:\\ShareFrame\\App',
        file: path.basename(installerPath),
        installScope: 'current-user',
        sha256: installerChecksum,
        silentArguments: '/S',
        sizeBytes: installerStats.size,
        type: 'nsis',
      },
      license: {
        commercialUse: 'Separate written licence required',
        contact: 'glyn@twohandsnetwork.co.uk',
        name: 'PolyForm Noncommercial License 1.0.0',
      },
      productName: 'ShareFrame',
      repository: 'https://github.com/Martin123132/opencast',
      runtime: {
        dataRoot: 'D:\\ShareFrame\\data',
        desktopStateRoot: 'D:\\ShareFrame\\desktop',
        tempRoot: 'D:\\ShareFrame\\temp',
      },
      schemaVersion: 1,
      source: {
        commit: readGitValue(['rev-parse', 'HEAD']),
        dirty: readGitValue(['status', '--porcelain', '--untracked-files=no']).length > 0,
      },
      version: packageJson.version,
    },
    null,
    2,
  )}\n`,
  'utf8',
)

process.stdout.write(
  [
    '',
    'ShareFrame desktop installer built on D:.',
    `Installer: ${installerPath}`,
    `Checksum:  ${checksumPath}`,
    `App store: ${manifestPath}`,
    '',
  ].join('\n'),
)

async function findInstaller(root: string): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true })

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name)

    if (entry.isDirectory()) {
      const nested = await findInstallerOrNull(entryPath)
      if (nested) {
        return nested
      }
      continue
    }

    if (entry.isFile() && /-Setup\.exe$/i.test(entry.name)) {
      return entryPath
    }
  }

  throw new Error(`ShareFrame desktop installer was not created under ${root}.`)
}

async function findInstallerOrNull(root: string): Promise<string | null> {
  const entries = await readdir(root, { withFileTypes: true })

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name)

    if (entry.isDirectory()) {
      const nested = await findInstallerOrNull(entryPath)
      if (nested) {
        return nested
      }
    } else if (entry.isFile() && /-Setup\.exe$/i.test(entry.name)) {
      return entryPath
    }
  }

  return null
}

async function sha256(filePath: string) {
  const contents = await readFile(filePath)
  return createHash('sha256').update(contents).digest('hex')
}

function readGitValue(argumentsList: string[]) {
  try {
    return execFileSync('git', argumentsList, {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
    }).trim()
  } catch {
    return 'unknown'
  }
}

async function removeGeneratedRelease(targetPath: string) {
  const resolvedTarget = assertDDrivePath(targetPath, 'Generated desktop release path')
  const releaseBoundary = assertDDrivePath(path.join(repoRoot, 'release'), 'Release boundary')
  const relative = path.relative(releaseBoundary, resolvedTarget)

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clean desktop release path outside ${releaseBoundary}.`)
  }

  await rm(resolvedTarget, { force: true, recursive: true })
}

function runCommand(file: string, argumentsList: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(file, argumentsList, {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    })

    child.once('error', reject)
    child.once('exit', (exitCode) => {
      if (exitCode === 0) {
        resolve()
        return
      }

      reject(new Error(`${path.basename(file)} exited with code ${exitCode ?? 'unknown'}.`))
    })
  })
}
