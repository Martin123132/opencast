import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export interface EvidenceTemplateOptions {
  sourceSha?: string
  ciUrl?: string
  checkCommand?: string
  timestamp?: string
}

export interface EvidenceGeneratorOptions extends EvidenceTemplateOptions {
  outputDirectory?: string
  sourcePath?: string
}

const TEMPLATE_FOOTER = '## Evidence links'
const DEFAULT_COMMAND = 'npm run evidence:share-lifecycle'

export function buildShareLifecycleEvidenceDraft({
  sourceSha = '<SOURCE_SHA>',
  ciUrl = 'https://github.com/Martin123132/opencast/actions/runs/<RUN_ID>',
  checkCommand = DEFAULT_COMMAND,
  timestamp = new Date().toISOString(),
}: EvidenceTemplateOptions = {}) {
  return `# Share lifecycle evidence draft

Date: ${timestamp}
Source SHA: ${sourceSha}
Release command: ${checkCommand}
GitHub CI run: ${ciUrl}

## Mandatory checks

- [ ] npm run lint
- [ ] npm run build
- [ ] npm run test
- [ ] npm run test:e2e

## Share lifecycle coverage

- [ ] Create path validated (recording -> create link)
- [ ] Revoke path validated
- [ ] Reload/persistence path validated (\`shareToken\` and \`shareWasRevoked\`)
- [ ] Recreate path validated
- [ ] Stale-token blocking verified
- [ ] Owner vs guest expectation state reviewed
- [ ] Non-leaky guest responses verified

## Notes

Add concise release notes here:

${TEMPLATE_FOOTER}
- share-lifecycle-release: evidence placeholders ready
- old link behavior verified: revoked link is unavailable and non-leaky
`
}

export async function writeShareLifecycleEvidenceDraft({
  outputDirectory = path.resolve(process.cwd(), '.evidence'),
  sourcePath = 'share-lifecycle-evidence',
  sourceSha,
  ciUrl,
  checkCommand,
  timestamp,
}: EvidenceGeneratorOptions = {}) {
  const safeSource = `${sourcePath}-${new Date(timestamp || Date.now()).toISOString().replace(/[^\w-]/g, '-')}`
  const fileName = `${safeSource}.md`
  const filePath = path.join(outputDirectory, fileName)

  await mkdir(outputDirectory, { recursive: true })

  const draft = buildShareLifecycleEvidenceDraft({
    sourceSha,
    ciUrl,
    checkCommand,
    timestamp,
  })

  await writeFile(filePath, draft, 'utf8')

  return {
    filePath,
    content: draft,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outputDirectory = process.argv.includes('--output')
    ? process.argv[process.argv.indexOf('--output') + 1]
    : undefined
  const sourceSha = process.argv.includes('--source-sha')
    ? process.argv[process.argv.indexOf('--source-sha') + 1]
    : undefined
  const ciUrl = process.argv.includes('--ci-url')
    ? process.argv[process.argv.indexOf('--ci-url') + 1]
    : undefined

  const result = await writeShareLifecycleEvidenceDraft({
    outputDirectory,
    sourceSha,
    ciUrl,
  })
  console.log(`Created share-lifecycle evidence draft at: ${result.filePath}`)
}
