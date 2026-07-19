import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'

const repoRoot = process.cwd()
const cDrivePathPattern = /\bC:[\\/]/i
const sharedPathEntries = [
  '.env.example',
  '.github',
  'build',
  'COMMERCIAL-LICENSE.md',
  'desktop',
  'MANUAL_QA.md',
  'NOTICE.md',
  'packaging',
  'pkg.config.mjs',
  'README.md',
  'ROADMAP.md',
  'SHARE_LIFECYCLE_PRIVACY_CHECKLIST.md',
  'package.json',
  'playwright.config.ts',
  'scripts',
  'server',
  'src',
  'tsconfig.desktop.json',
  'tsconfig.package.json',
  'vite.config.ts',
]
const deliberateNegativeTestFiles = new Set([
  'tests/config.test.ts',
  'tests/share-lifecycle-checklist.test.ts',
  'tests/path-guards.test.ts',
])
const ignoredDirectoryNames = new Set([
  '.cache',
  '.evidence',
  '.git',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
])

type PathMatch = {
  filePath: string
  lineNumber: number
  line: string
}

test('shared docs, scripts, config, and app code do not contain C-drive paths', async () => {
  const matches = await findCDrivePathMatches(sharedPathEntries)

  assert.deepEqual(
    formatMatches(matches),
    [],
    'Shared docs, scripts, config, and app code should keep generated/runtime path examples on D:',
  )
})

test('C-drive fixtures only appear in deliberate rejection tests', async () => {
  const matches = await findCDrivePathMatches(['tests'])
  const unexpectedMatches = matches.filter((match) => !deliberateNegativeTestFiles.has(match.filePath))

  assert.deepEqual(
    formatMatches(unexpectedMatches),
    [],
    'C-drive paths in tests should be limited to explicit rejection coverage',
  )
})

async function findCDrivePathMatches(entries: string[]) {
  const files = (
    await Promise.all(entries.map((entry) => collectTextFiles(path.join(repoRoot, entry))))
  ).flat()
  const matches: PathMatch[] = []

  for (const filePath of files) {
    const contents = await readFile(filePath, 'utf8')
    const lines = contents.split(/\r?\n/)

    lines.forEach((line, index) => {
      if (cDrivePathPattern.test(line)) {
        matches.push({
          filePath: toRepoPath(filePath),
          lineNumber: index + 1,
          line: line.trim(),
        })
      }
    })
  }

  return matches
}

async function collectTextFiles(targetPath: string): Promise<string[]> {
  const targetStat = await stat(targetPath)

  if (targetStat.isFile()) {
    return [targetPath]
  }

  const entries = await readdir(targetPath, { withFileTypes: true })
  const files = await Promise.all(
    entries.flatMap((entry) => {
      if (entry.isDirectory()) {
        if (ignoredDirectoryNames.has(entry.name)) {
          return []
        }

        return collectTextFiles(path.join(targetPath, entry.name))
      }

      if (!entry.isFile() || !isScannedTextFile(entry.name)) {
        return []
      }

      return [path.join(targetPath, entry.name)]
    }),
  )

  return files.flat()
}

function isScannedTextFile(fileName: string) {
  return (
    fileName.endsWith('.example') ||
    fileName.endsWith('.cjs') ||
    fileName.endsWith('.css') ||
    fileName.endsWith('.html') ||
    fileName.endsWith('.js') ||
    fileName.endsWith('.json') ||
    fileName.endsWith('.md') ||
    fileName.endsWith('.mjs') ||
    fileName.endsWith('.nsh') ||
    fileName.endsWith('.ts') ||
    fileName.endsWith('.tsx') ||
    fileName.endsWith('.yaml') ||
    fileName.endsWith('.yml')
  )
}

function toRepoPath(filePath: string) {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/')
}

function formatMatches(matches: PathMatch[]) {
  return matches.map((match) => `${match.filePath}:${match.lineNumber}: ${match.line}`)
}
