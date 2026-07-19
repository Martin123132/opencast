import { spawn } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pngToIco from 'png-to-ico'
import sharp from 'sharp'
import { assertDDrivePath } from './path-guards.js'

const scriptPath = fileURLToPath(import.meta.url)
const repoRoot = path.resolve(path.dirname(scriptPath), '..')
const workspaceRoot = path.dirname(repoRoot)
const desktopBuildRoot = assertDDrivePath(path.join(repoRoot, '.desktop'), 'Desktop build root')
const buildResourcesRoot = assertDDrivePath(path.join(repoRoot, 'build'), 'Build resources root')
const tempRoot = assertDDrivePath(path.join(workspaceRoot, '.temp'), 'Desktop temp root')
const npmCache = assertDDrivePath(path.join(workspaceRoot, '.cache', 'npm'), 'npm cache')

export async function prepareDesktopBuild() {
  for (const directory of [tempRoot, npmCache, buildResourcesRoot]) {
    await mkdir(directory, { recursive: true })
  }

  Object.assign(process.env, {
    TEMP: tempRoot,
    TMP: tempRoot,
    npm_config_cache: npmCache,
  })

  await removeGeneratedPath(desktopBuildRoot, repoRoot)
  await mkdir(desktopBuildRoot, { recursive: true })

  const npmCli = process.env.npm_execpath

  if (!npmCli) {
    throw new Error('npm_execpath was not provided. Run this command through npm.cmd.')
  }

  await runCommand(process.execPath, [npmCli, 'run', 'build'])
  await runCommand(process.execPath, [
    path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
    '-p',
    'tsconfig.desktop.json',
  ])

  await cp(path.join(repoRoot, 'dist'), path.join(desktopBuildRoot, 'dist'), {
    recursive: true,
  })

  const desktopAssets = [
    'picker-preload.cjs',
    'picker.html',
    'picker.css',
    'picker-renderer.js',
  ]
  const compiledDesktopRoot = path.join(desktopBuildRoot, 'desktop')
  await mkdir(compiledDesktopRoot, { recursive: true })

  for (const asset of desktopAssets) {
    await cp(path.join(repoRoot, 'desktop', asset), path.join(compiledDesktopRoot, asset))
  }

  await generateDesktopIcons(compiledDesktopRoot)
  process.stdout.write(`ShareFrame desktop build prepared at ${desktopBuildRoot}.\n`)
}

async function generateDesktopIcons(compiledDesktopRoot: string) {
  const svg = await readFile(path.join(repoRoot, 'public', 'favicon.svg'))
  const iconAssetsRoot = path.join(desktopBuildRoot, 'icon-assets')
  const iconSizes = [16, 24, 32, 48, 64, 128, 256]
  await mkdir(iconAssetsRoot, { recursive: true })

  const iconPaths = await Promise.all(
    iconSizes.map(async (size) => {
      const iconPath = path.join(iconAssetsRoot, `shareframe-${size}.png`)
      await sharp(svg).resize(size, size, { fit: 'contain' }).png().toFile(iconPath)
      return iconPath
    }),
  )
  const desktopPng = await sharp(svg).resize(512, 512, { fit: 'contain' }).png().toBuffer()
  await writeFile(path.join(buildResourcesRoot, 'shareframe.ico'), await pngToIco(iconPaths))
  await writeFile(path.join(buildResourcesRoot, 'shareframe.png'), desktopPng)
  await writeFile(path.join(compiledDesktopRoot, 'shareframe.png'), desktopPng)
}

async function removeGeneratedPath(targetPath: string, allowedRoot: string) {
  const resolvedTarget = assertDDrivePath(targetPath, 'Generated desktop path')
  const resolvedRoot = assertDDrivePath(allowedRoot, 'Generated desktop boundary')
  const relative = path.relative(resolvedRoot, resolvedTarget)

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clean desktop path outside ${resolvedRoot}: ${resolvedTarget}`)
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

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
  await prepareDesktopBuild()
}
