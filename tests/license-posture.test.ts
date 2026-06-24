import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import path from 'node:path'

const expectedPackageLicense = 'SEE LICENSE IN LICENSE'

test('root package metadata points to the repository license file', async () => {
  const packagePath = path.resolve(process.cwd(), 'package.json')
  const packageLockPath = path.resolve(process.cwd(), 'package-lock.json')

  const packageContents = JSON.parse(await readFile(packagePath, 'utf8')) as { license?: string }
  const packageLock = JSON.parse(await readFile(packageLockPath, 'utf8')) as {
    packages?: Record<string, { license?: string }>
  }

  assert.equal(packageContents.license, expectedPackageLicense)
  assert.equal(packageLock.packages?.['']?.license, expectedPackageLicense)
})

test('public docs state the source-available non-commercial posture', async () => {
  const readme = await readPublicFile('README.md')
  const notice = await readPublicFile('NOTICE.md')
  const commercialLicense = await readPublicFile('COMMERCIAL-LICENSE.md')

  assertIncludes(readme, [
    'source-available software, not open-source software',
    'PolyForm Noncommercial License 1.0.0',
    'Commercial use requires a separate written license from TWO HANDS NETWORK LTD',
    'Contact the COO of TWO HANDS NETWORK LTD',
  ])

  assertIncludes(notice, [
    'source-available software, not open-source software',
    'PolyForm Noncommercial License 1.0.0',
    'Commercial use requires a separate written license',
    'Contact the COO of TWO HANDS NETWORK LTD',
    'TWO HANDS NETWORK LTD',
  ])

  assertIncludes(commercialLicense, [
    'personal and non-commercial use',
    'Commercial use is not included in the public license',
    'Contact the COO of TWO HANDS NETWORK LTD',
    'No commercial license is granted unless agreed in writing',
  ])
})

test('public product docs do not describe ShareFrame as open source', async () => {
  const filesToCheck = ['README.md', 'ROADMAP.md', 'package.json']

  for (const fileName of filesToCheck) {
    const content = removeNegativeOpenSourceClarification(await readPublicFile(fileName))
    assert.doesNotMatch(
      content,
      /\bopen[- ]source\b/i,
      `${fileName} should use source-available wording instead of open-source wording`,
    )
  }
})

async function readPublicFile(fileName: string) {
  return readFile(path.resolve(process.cwd(), fileName), 'utf8')
}

function assertIncludes(text: string, expectedFragments: string[]) {
  for (const fragment of expectedFragments) {
    assert.ok(text.includes(fragment), `Expected public licensing text to include: ${fragment}`)
  }
}

function removeNegativeOpenSourceClarification(text: string) {
  return text
    .replace(/\bnot\s+open[- ]source\s+software\b/gi, '')
    .replace(/D:\\open-source\\/gi, 'D:\\')
}
