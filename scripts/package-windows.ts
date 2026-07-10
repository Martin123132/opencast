import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exec as packageExecutable } from '@yao-pkg/pkg'
import { assertDDrivePath } from './path-guards.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = path.dirname(repoRoot)
const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')) as {
  version: string
}
const packageName = `ShareFrame-${packageJson.version}-win-x64`
const compileRoot = assertDDrivePath(path.join(repoRoot, '.package'), 'Package compile root')
const releaseRoot = assertDDrivePath(path.join(repoRoot, 'release'), 'Package release root')
const packageRoot = assertDDrivePath(path.join(releaseRoot, packageName), 'Windows package root')
const executablePath = path.join(packageRoot, 'ShareFrame.exe')
const archivePath = path.join(releaseRoot, `${packageName}.zip`)
const archiveChecksumPath = `${archivePath}.sha256`
const tempRoot = assertDDrivePath(path.join(workspaceRoot, '.temp'), 'Package temp root')
const npmCache = assertDDrivePath(path.join(workspaceRoot, '.cache', 'npm'), 'npm cache')
const pkgCache = assertDDrivePath(path.join(workspaceRoot, '.cache', 'pkg'), 'pkg cache')

if (process.platform !== 'win32') {
  throw new Error('ShareFrame Windows packaging must run on Windows.')
}

for (const directory of [tempRoot, npmCache, pkgCache, releaseRoot]) {
  await mkdir(directory, { recursive: true })
}

Object.assign(process.env, {
  TEMP: tempRoot,
  TMP: tempRoot,
  npm_config_cache: npmCache,
  PKG_CACHE_PATH: pkgCache,
})

await removeGeneratedPath(compileRoot, repoRoot)
await removeGeneratedPath(packageRoot, releaseRoot)
await removeGeneratedPath(archivePath, releaseRoot)
await removeGeneratedPath(archiveChecksumPath, releaseRoot)
await mkdir(packageRoot, { recursive: true })

const npmCli = process.env.npm_execpath

if (!npmCli) {
  throw new Error('npm_execpath was not provided. Run packaging with npm.cmd run package:windows.')
}

await runCommand(process.execPath, [npmCli, 'run', 'build'])
await runCommand(process.execPath, [path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
  '-p',
  'tsconfig.package.json',
])

process.stdout.write('\nBuilding self-contained ShareFrame.exe...\n')
await packageExecutable([
  '.',
  '--targets',
  'node24-win-x64',
  '--output',
  executablePath,
  '--sea',
])

await copyPackageDocuments(packageRoot, packageJson.version)
await writeBuildInfo(packageRoot, packageJson.version)

const executableChecksum = await sha256(executablePath)
await writeFile(
  path.join(packageRoot, 'SHA256SUMS.txt'),
  `${executableChecksum}  ShareFrame.exe\n`,
  'utf8',
)

await runCommand('tar.exe', [
  '-a',
  '-c',
  '-f',
  archivePath,
  '-C',
  releaseRoot,
  packageName,
])

const archiveChecksum = await sha256(archivePath)
await writeFile(
  archiveChecksumPath,
  `${archiveChecksum}  ${path.basename(archivePath)}\n`,
  'utf8',
)

process.stdout.write(
  [
    '',
    'ShareFrame portable package built on D:.',
    `Folder:   ${packageRoot}`,
    `Archive:  ${archivePath}`,
    `Checksum: ${archiveChecksumPath}`,
    '',
  ].join('\n'),
)

async function copyPackageDocuments(targetRoot: string, version: string) {
  const documents = ['LICENSE', 'NOTICE.md', 'COMMERCIAL-LICENSE.md']

  for (const document of documents) {
    await copyFile(path.join(repoRoot, document), path.join(targetRoot, document))
  }

  const startHereTemplate = await readFile(
    path.join(repoRoot, 'packaging', 'START-HERE.txt'),
    'utf8',
  )
  await writeFile(
    path.join(targetRoot, 'START-HERE.txt'),
    startHereTemplate.replaceAll('{{VERSION}}', version),
    'utf8',
  )
}

async function writeBuildInfo(targetRoot: string, version: string) {
  const sourceCommit = readGitValue(['rev-parse', 'HEAD'])
  const dirty = readGitValue(['status', '--porcelain', '--untracked-files=no']).length > 0
  const buildInfo = {
    product: 'ShareFrame',
    version,
    target: 'win-x64',
    runtime: 'node24-sea',
    builtAt: new Date().toISOString(),
    sourceCommit,
    dirty,
  }

  await writeFile(
    path.join(targetRoot, 'BUILD-INFO.json'),
    `${JSON.stringify(buildInfo, null, 2)}\n`,
    'utf8',
  )
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

async function sha256(filePath: string) {
  const contents = await readFile(filePath)
  return createHash('sha256').update(contents).digest('hex')
}

async function removeGeneratedPath(targetPath: string, allowedRoot: string) {
  const resolvedTarget = assertDDrivePath(targetPath, 'Generated package path')
  const resolvedRoot = assertDDrivePath(allowedRoot, 'Generated package boundary')
  const relative = path.relative(resolvedRoot, resolvedTarget)

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clean package path outside ${resolvedRoot}: ${resolvedTarget}`)
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
