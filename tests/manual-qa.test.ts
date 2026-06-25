import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'

test('manual QA checklist is linked and covers human-only capture/privacy flows', async () => {
  const readme = await readPublicFile('README.md')
  const checklist = await readPublicFile('MANUAL_QA.md')

  assert.ok(readme.includes('[`MANUAL_QA.md`](./MANUAL_QA.md)'), 'README should link the manual QA checklist')
  assertIncludes(checklist, [
    'Confirm the visible data root and all screenshots/logs/evidence are on `D:\\`.',
    'source-available for personal and non-commercial use',
    'browser capture permission prompt',
    'Cancel the picker',
    'Deny permission',
    'Toggle mic off and on',
    'Toggle camera off and on',
    'Pause, resume, then stop',
    'Create a guest link',
    'Revoke the guest link',
    'non-leaky unavailable copy',
    'GitHub CI URL',
  ])
  assert.doesNotMatch(checklist, /\bC:[\\/]/i, 'manual QA evidence paths should stay D-drive first')
})

async function readPublicFile(fileName: string) {
  return readFile(path.resolve(process.cwd(), fileName), 'utf8')
}

function assertIncludes(text: string, expectedFragments: string[]) {
  for (const fragment of expectedFragments) {
    assert.ok(text.includes(fragment), `Expected manual QA checklist to include: ${fragment}`)
  }
}
