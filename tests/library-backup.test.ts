import assert from 'node:assert/strict'
import { readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import {
  createLibraryBackup,
  getLibraryBackupPreview,
  listLibraryBackups,
  restoreLibraryBackup,
} from '../server/libraryBackup.ts'
import { appConfig, storagePaths } from '../server/config.ts'
import {
  createShare,
  deleteRecording,
  ensureStorage,
  getRecordingByShareToken,
  listRecordings,
  saveRecording,
} from '../server/store.ts'

const isolatedStoreRoot = path.join(appConfig.dataRoot, 'tests', 'library-backup')
const isolatePaths = {
  recordingsDir: path.join(isolatedStoreRoot, 'recordings'),
  thumbnailsDir: path.join(isolatedStoreRoot, 'thumbnails'),
  backupsDir: path.join(isolatedStoreRoot, 'backups'),
  indexFile: path.join(isolatedStoreRoot, 'index.json'),
  indexBackupsDir: path.join(isolatedStoreRoot, 'index-backups'),
  shareSecretFile: path.join(isolatedStoreRoot, 'share-secret.key'),
}

test('creates a complete D-drive backup with index, recording, thumbnail, and manifest', async () => {
  await withBackupStore(async () => {
    const recording = await saveRecording({
      file: buildTestFile(),
      title: 'Backup fixture',
      durationMs: 2000,
      thumbnail: {
        data: Buffer.from('backup-poster'),
        mimetype: 'image/png',
      },
    })

    const backup = await createLibraryBackup()
    const listedBackups = await listLibraryBackups()
    const preview = await getLibraryBackupPreview(backup.id)

    assert.equal(backup.status, 'complete')
    assert.equal(backup.recordingCount, 1)
    assert.equal(backup.copiedRecordingFiles, 1)
    assert.equal(backup.copiedThumbnailFiles, 1)
    assert.equal(backup.missingRecordingFiles, 0)
    assert.equal(backup.missingThumbnailFiles, 0)
    assert.ok(backup.path.startsWith(isolatePaths.backupsDir))
    assert.equal(listedBackups.length, 1)
    assert.equal(listedBackups[0]?.id, backup.id)
    assert.equal(listedBackups[0]?.status, 'complete')
    assert.equal(preview?.restoreMode, 'preview-only')
    assert.match(preview?.privacyNote ?? '', /must not reactivate old public share links/)
    assert.deepEqual(preview?.recordings, [
      {
        id: recording.id,
        title: 'Backup fixture',
        fileName: recording.fileName,
        thumbnailFileName: recording.thumbnailFileName,
        videoPresent: true,
        thumbnailPresent: true,
      },
    ])

    await stat(path.join(backup.path, 'recordings', recording.fileName))
    await stat(path.join(backup.path, 'thumbnails', recording.thumbnailFileName!))
    await stat(backup.indexPath)
    await stat(backup.manifestPath)

    const manifest = JSON.parse(await readFile(backup.manifestPath, 'utf8')) as {
      schemaVersion?: number
      status?: string
      recordingCount?: number
      recordings?: Array<{
        id: string
        title: string
        fileName: string
        thumbnailFileName: string | null
      }>
    }
    assert.equal(manifest.schemaVersion, 1)
    assert.equal(manifest.status, 'complete')
    assert.equal(manifest.recordingCount, 1)
    assert.deepEqual(manifest.recordings, [
      {
        id: recording.id,
        title: 'Backup fixture',
        fileName: recording.fileName,
        thumbnailFileName: recording.thumbnailFileName,
      },
    ])
  })
})

test('marks a listed backup partial when a copied recording file is missing', async () => {
  await withBackupStore(async () => {
    const recording = await saveRecording({
      file: buildTestFile(),
      title: 'Partial backup fixture',
      durationMs: 2000,
    })
    const backup = await createLibraryBackup()

    await rm(path.join(backup.path, 'recordings', recording.fileName), { force: true })

    const listedBackups = await listLibraryBackups()

    assert.equal(listedBackups.length, 1)
    assert.equal(listedBackups[0]?.status, 'partial')
    assert.equal(listedBackups[0]?.copiedRecordingFiles, 0)
    assert.equal(listedBackups[0]?.missingRecordingFiles, 1)

    const restore = await restoreLibraryBackup(backup.id)

    assert.equal(restore?.restoreStatus, 'partial')
    assert.equal(restore?.importedRecordingCount, 0)
    assert.equal(restore?.skippedRecordingCount, 1)
  })
})

test('restores a backup as private copies without resurrecting share state', async () => {
  await withBackupStore(async () => {
    const recording = await saveRecording({
      file: buildTestFile(),
      title: 'Shared backup fixture',
      durationMs: 3000,
      durationSource: 'media',
      thumbnail: {
        data: Buffer.from('private-restore-poster'),
        mimetype: 'image/png',
      },
    })
    const sharedRecording = await createShare(recording.id, {
      downloadEnabled: false,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      password: 'restore-secret',
    })
    const oldShareToken = sharedRecording?.shareToken

    assert.ok(oldShareToken)

    const backup = await createLibraryBackup()
    await deleteRecording(recording.id)

    const restore = await restoreLibraryBackup(backup.id)
    const restored = restore?.importedRecordings[0]
    const recordings = await listRecordings()

    assert.equal(restore?.restoreMode, 'private-copy')
    assert.equal(restore?.restoreStatus, 'complete')
    assert.equal(restore?.importedRecordingCount, 1)
    assert.equal(restore?.skippedRecordingCount, 0)
    assert.match(restore?.privacyNote ?? '', /Old public links/)
    assert.equal(recordings.length, 1)
    assert.ok(restored)
    assert.notEqual(restored.id, recording.id)
    assert.equal(restored.title, 'Shared backup fixture')
    assert.equal(restored.durationMs, 3000)
    assert.equal(restored.durationSource, 'media')
    assert.equal(restored.shareToken, null)
    assert.equal(restored.shareExpiresAt, null)
    assert.equal(restored.shareWasRevoked, false)
    assert.equal(restored.shareDownloadEnabled, true)
    assert.equal(restored.sharePasswordHash, null)
    assert.equal(restored.sharePasswordSalt, null)
    assert.equal(restored.viewCount, 0)
    assert.equal(await getRecordingByShareToken(oldShareToken), null)

    await stat(path.join(isolatePaths.recordingsDir, restored.fileName))
    await stat(path.join(isolatePaths.thumbnailsDir, restored.thumbnailFileName!))
  })
})

async function withBackupStore<T>(callback: () => Promise<T>) {
  const originalPaths = { ...storagePaths }
  storagePaths.recordingsDir = isolatePaths.recordingsDir
  storagePaths.thumbnailsDir = isolatePaths.thumbnailsDir
  storagePaths.backupsDir = isolatePaths.backupsDir
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
    storagePaths.backupsDir = originalPaths.backupsDir
    storagePaths.indexFile = originalPaths.indexFile
    storagePaths.indexBackupsDir = originalPaths.indexBackupsDir
    storagePaths.shareSecretFile = originalPaths.shareSecretFile
    await rm(isolatedStoreRoot, { force: true, recursive: true })
  }
}

function buildTestFile() {
  return {
    file: Readable.from([Buffer.from('shareframe library backup fixture')]),
    filename: 'fixture.webm',
    encoding: '7bit',
    mimetype: 'video/webm',
    fieldname: 'video',
  }
}
