import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import { test } from 'node:test'
import path from 'node:path'
import { writeShareLifecycleEvidenceDraft } from '../scripts/share-lifecycle-evidence.ts'

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

test('PR review checklist requires share lifecycle privacy validation', async () => {
  const templatePath = path.resolve(process.cwd(), '.github', 'PULL_REQUEST_TEMPLATE.md')
  const template = await readFile(templatePath, 'utf8')

  assertChecklistContains(template.toLowerCase(), [
    'share lifecycle privacy review',
    'share-lifecycle privacy checklist',
    'create/revoke/recreate',
    'reload/persistence',
    'stale-token',
    'owner vs guest',
    'non-leaky',
    'npm run test',
    'npm run test:e2e',
    'sharetoken',
    'sharewasrevoked',
  ])

  const readmePath = path.resolve(process.cwd(), 'README.md')
  const readme = await readFile(readmePath, 'utf8')
  assert.equal(
    checkForLink(readme, 'PULL_REQUEST_TEMPLATE.md'),
    true,
    'README should link the PR review checklist',
  )
})

test('release review template captures share lifecycle privacy evidence', async () => {
  const templatePath = path.resolve(
    process.cwd(),
    '.github',
    'SHARE_LIFECYCLE_RELEASE_REVIEW_TEMPLATE.md',
  )
  const releaseTemplate = await readFile(templatePath, 'utf8')

  assertChecklistContains(releaseTemplate.toLowerCase(), [
    'share lifecycle release review',
    'mandatory validation checks',
    'create path validated',
    'revoke path validated',
    'reload/persistence',
    'recreate path validated',
    'old/stale token blocked',
    'owner state is explicit',
    'guest flow remains safe',
    'guest responses do not leak',
    'npm run lint',
    'npm run build',
    'npm run test',
    'npm run test:e2e',
    'ci run url',
  ])

  const readmePath = path.resolve(process.cwd(), 'README.md')
  const readme = await readFile(readmePath, 'utf8')
  assert.equal(
    checkForLink(readme, 'SHARE_LIFECYCLE_RELEASE_REVIEW_TEMPLATE.md'),
    true,
    'README should link the release review evidence template',
  )
})

test('share lifecycle evidence generator command and ignore location stay wired', async () => {
  const packagePath = path.resolve(process.cwd(), 'package.json')
  const gitignorePath = path.resolve(process.cwd(), '.gitignore')

  const packageContents = JSON.parse(await readFile(packagePath, 'utf8'))
  const gitignore = await readFile(gitignorePath, 'utf8')
  const readmePath = path.resolve(process.cwd(), 'README.md')
  const readme = await readFile(readmePath, 'utf8')

  assert.equal(
    packageContents.scripts['evidence:share-lifecycle'],
    'tsx scripts/share-lifecycle-evidence.ts',
    'Package script should point to evidence generator',
  )

  assert.equal(
    checkForLink(readme, 'evidence:share-lifecycle'),
    true,
    'README should document evidence generator command',
  )

  assert.ok(gitignore.includes('.evidence'), 'Evidence draft path should be git-ignored')
})

test('share lifecycle evidence generator creates ignored draft with required sections', async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'share-lifecycle-evidence-'))
  const sourcePath = 'share-lifecycle-evidence'
  const sourceSha = 'abc1234'
  const ciUrl = 'https://github.com/Martin123132/opencast/actions/runs/999'
  const timestamp = '2026-06-22T12:00:00.000Z'

  try {
    const { filePath, content } = await writeShareLifecycleEvidenceDraft({
      outputDirectory,
      sourcePath,
      sourceSha,
      ciUrl,
      checkCommand: 'npm run evidence:share-lifecycle',
      timestamp,
    })

    assert.ok(filePath.startsWith(outputDirectory), 'Generated file should be in requested output directory')
    assert.ok(filePath.endsWith('.md'), 'Generated evidence draft should be markdown')

    assert.ok(
      content.includes('Share lifecycle coverage'),
      'Generated evidence should include share lifecycle coverage section',
    )
    assert.ok(
      content.includes('Create path validated'),
      'Generated evidence should include create path validation',
    )
    assert.ok(
      content.includes('Revoke path validated'),
      'Generated evidence should include revoke path validation',
    )
    assert.ok(
      content.includes('Reload/persistence path validated'),
      'Generated evidence should include reload/persistence validation',
    )
    assert.ok(
      content.includes('Recreate path validated'),
      'Generated evidence should include recreate path validation',
    )
    assert.ok(
      content.includes('Stale-token blocking verified'),
      'Generated evidence should include stale-token blocking',
    )
    assert.ok(
      content.includes('Owner vs guest expectation'),
      'Generated evidence should include owner vs guest expectations',
    )
    assert.ok(
      content.includes('Non-leaky guest responses verified'),
      'Generated evidence should include non-leaky guest response verification',
    )
    assert.ok(
      content.includes('npm run lint'),
      'Generated evidence should include lint/test/build/e2e required checks',
    )
    assert.ok(
      content.includes('npm run test:e2e'),
      'Generated evidence should include E2E requirement',
    )
    assert.ok(content.includes(ciUrl), 'Generated evidence should include CI URL placeholder/value')
    assert.ok(content.includes(sourceSha), 'Generated evidence should include source SHA')
  } finally {
    await rm(outputDirectory, { force: true, recursive: true })
  }
})
