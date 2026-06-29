import assert from 'node:assert/strict'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { appConfig, storagePaths } from '../server/config.ts'
import {
  deleteRecording,
  ensureStorage,
  getThumbnailFile,
  listRecordings,
  saveRecording,
  toPublicRecording,
} from '../server/store.ts'

const isolatedStoreRoot = path.join(appConfig.dataRoot, 'tests', 'recording-metadata')
const isolatePaths = {
  recordingsDir: path.join(isolatedStoreRoot, 'recordings'),
  thumbnailsDir: path.join(isolatedStoreRoot, 'thumbnails'),
  indexFile: path.join(isolatedStoreRoot, 'index.json'),
  indexBackupsDir: path.join(isolatedStoreRoot, 'index-backups'),
  shareSecretFile: path.join(isolatedStoreRoot, 'share-secret.key'),
}

async function withMetadataStore<T>(callback: () => Promise<T>) {
  const originalPaths = { ...storagePaths }
  storagePaths.recordingsDir = isolatePaths.recordingsDir
  storagePaths.thumbnailsDir = isolatePaths.thumbnailsDir
  storagePaths.indexFile = isolatePaths.indexFile
  storagePaths.indexBackupsDir = isolatePaths.indexBackupsDir
  storagePaths.shareSecretFile = isolatePaths.shareSecretFile

  await rm(isolatedStoreRoot, { force: true, recursive: true })
  await ensureStorage()

  try {
    return await callback()
  } finally {
    storagePaths.recordingsDir = originalPaths.recordingsDir
    storagePaths.thumbnailsDir = originalPaths.thumbnailsDir
    storagePaths.indexFile = originalPaths.indexFile
    storagePaths.indexBackupsDir = originalPaths.indexBackupsDir
    storagePaths.shareSecretFile = originalPaths.shareSecretFile
    await rm(isolatedStoreRoot, { force: true, recursive: true })
  }
}

function buildTestFile() {
  return {
    file: Readable.from([Buffer.from('shareframe recording metadata fixture')]),
    filename: 'fixture.webm',
    encoding: '7bit',
    mimetype: 'video/webm',
    fieldname: 'video',
  }
}

test('stores optional recording poster metadata and removes the poster with the recording', async () => {
  await withMetadataStore(async () => {
    const recording = await saveRecording({
      file: buildTestFile(),
      title: 'Poster fixture',
      durationMs: 2500,
      thumbnail: {
        data: Buffer.from('fake-png-poster'),
        mimetype: 'image/png',
      },
    })

    assert.equal(recording.thumbnailFileName, `${recording.id}-poster.png`)
    assert.equal(recording.thumbnailMimeType, 'image/png')

    const publicRecording = toPublicRecording(recording)
    assert.equal(publicRecording.thumbnailUrl, `/api/recordings/${recording.id}/thumbnail`)
    assert.equal(publicRecording.thumbnailMimeType, 'image/png')

    const thumbnail = await getThumbnailFile(recording)
    assert.equal(thumbnail?.mimeType, 'image/png')
    assert.equal(thumbnail?.size, 'fake-png-poster'.length)
    assert.ok(thumbnail?.path.startsWith(isolatePaths.thumbnailsDir))

    await deleteRecording(recording.id)

    await assert.rejects(() => getThumbnailFile(recording), { code: 'ENOENT' })
  })
})

test('preserves a corrupt library index before recovering to an empty library', async () => {
  await withMetadataStore(async () => {
    await mkdir(path.dirname(isolatePaths.indexFile), { recursive: true })
    await writeFile(isolatePaths.indexFile, '{not valid json', 'utf8')

    const recordings = await listRecordings()
    assert.deepEqual(recordings, [])

    const backups = await readdir(isolatePaths.indexBackupsDir)
    assert.equal(backups.length, 1)
    assert.match(backups[0] ?? '', /^index-corrupt-/)

    const backupSource = await readFile(path.join(isolatePaths.indexBackupsDir, backups[0]!), 'utf8')
    assert.equal(backupSource, '{not valid json')

    const recoveredIndex = JSON.parse(await readFile(isolatePaths.indexFile, 'utf8')) as {
      recordings?: unknown[]
    }
    assert.deepEqual(recoveredIndex.recordings, [])
  })
})
