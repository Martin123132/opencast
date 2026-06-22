import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import path from 'node:path'

function assertChecklistContains(text: string, expectedFragments: string[]) {
  const normalized = text.toLowerCase()
  for (const fragment of expectedFragments) {
    assert.ok(
      normalized.includes(fragment),
      `Privacy checklist should include: "${fragment}"`,
    )
  }
}

test('share lifecycle privacy checklist is linked from README', async () => {
  const readmePath = path.resolve(process.cwd(), 'README.md')
  const checklistPath = path.resolve(process.cwd(), 'SHARE_LIFECYCLE_PRIVACY_CHECKLIST.md')

  const readme = await readFile(readmePath, 'utf8')
  const checklist = await readFile(checklistPath, 'utf8')

  assert.equal(
    checkForLink(readme, 'SHARE_LIFECYCLE_PRIVACY_CHECKLIST.md'),
    true,
    'README should link the share lifecycle privacy checklist',
  )

  assert.ok(
    checklist.includes('Share Lifecycle Privacy Contract'),
    'Checklist should include the title heading',
  )
})

function checkForLink(readmeContents: string, fileName: string) {
  const plain = readmeContents.toLowerCase()
  const normalizedFileName = fileName.toLowerCase()
  const normalizedReference = `./${normalizedFileName}`
  return (
    plain.includes(normalizedFileName) ||
    plain.includes(`(${normalizedFileName})`) ||
    plain.includes(`(${normalizedReference})`) ||
    plain.includes(`](${normalizedFileName})`) ||
    plain.includes(`](${normalizedReference})`)
  )
}

test('privacy checklist covers share lifecycle requirements end-to-end', async () => {
  const checklistPath = path.resolve(process.cwd(), 'SHARE_LIFECYCLE_PRIVACY_CHECKLIST.md')
  const checklist = await readFile(checklistPath, 'utf8')

  assertChecklistContains(checklist, [
    'new recording defaults are private and unshared',
    'after create',
    'owner reload/persistence',
    'revoke',
    'recreate',
    'guest non-leak',
    'old token no longer resolves',
    'guest path for old token returns non-leaky unavailable state',
    'sharewasrevoked',
    'new token is generated',
    'non-leaky unavailable response',
  ])
})
