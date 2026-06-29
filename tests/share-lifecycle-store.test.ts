import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import path from 'node:path'
import { appConfig, storagePaths } from '../server/config.ts'
import {
  createShare,
  ensureStorage,
  getRecording,
  getRecordingByShareToken,
  revokeShare,
  saveRecording,
} from '../server/store.ts'

const isolatedStoreRoot = path.join(appConfig.dataRoot, 'tests', 'share-lifecycle-store')
const isolatePaths = {
  recordingsDir: path.join(isolatedStoreRoot, 'recordings'),
  thumbnailsDir: path.join(isolatedStoreRoot, 'thumbnails'),
  indexFile: path.join(isolatedStoreRoot, 'index.json'),
  indexBackupsDir: path.join(isolatedStoreRoot, 'index-backups'),
  shareSecretFile: path.join(isolatedStoreRoot, 'share-secret.key'),
}

async function withSharedStore<T>(callback: () => Promise<T>) {
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
    file: Readable.from([Buffer.from('opencast share lifecycle fixture')]),
    filename: 'fixture.webm',
    encoding: '7bit',
    mimetype: 'video/webm',
    fieldname: 'video',
  }
}

test('records revoked share state in persisted recording metadata', async () => {
  await withSharedStore(async () => {
    const recording = await saveRecording({
      file: buildTestFile(),
      title: 'Persisted share lifecycle',
      durationMs: 2000,
    })

    assert.equal(recording.shareToken, null)
    assert.equal(recording.shareWasRevoked, false)

    const created = await createShare(recording.id)
    if (!created || !created.shareToken) {
      throw new Error('Failed to create initial share')
    }

    const revokedToken = created.shareToken
    assert.equal(revokedToken.length, 20)
    assert.equal(created?.shareWasRevoked, false)

    const revoked = await revokeShare(recording.id)
    assert.equal(revoked?.shareWasRevoked, true)
    assert.equal(revoked?.shareToken, null)

    const staleTokenLookup = await getRecordingByShareToken(revokedToken!)
    assert.equal(staleTokenLookup, null, 'revoked tokens should not resolve to a recording')
  })
})

test('recreate clears revoked flag and rotates share token', async () => {
  await withSharedStore(async () => {
    const recording = await saveRecording({
      file: buildTestFile(),
      title: 'Rotating share lifecycle',
      durationMs: 2000,
    })

    const firstShare = await createShare(recording.id)
    if (!firstShare || !firstShare.shareToken) {
      throw new Error('Failed to create initial share')
    }

    const firstToken = firstShare.shareToken
    assert.equal(firstToken.length, 20)

    await revokeShare(recording.id)

    const recreated = await createShare(recording.id)
    if (!recreated || !recreated.shareToken) {
      throw new Error('Failed to recreate share link')
    }

    const recreatedToken = recreated.shareToken
    assert.equal(recreatedToken.length, 20)
    assert.equal(recreated.shareWasRevoked, false)
    assert.notEqual(recreatedToken, firstToken)

    const refreshed = await getRecording(recording.id)
    assert.equal(refreshed?.shareWasRevoked, false)
    assert.equal(refreshed?.shareToken, recreatedToken)
    assert.notEqual(refreshed?.shareToken, firstToken)

    const staleTokenLookup = await getRecordingByShareToken(firstToken!)
    assert.equal(staleTokenLookup, null, 'old token should never resolve after revoke')

    const activeTokenLookup = await getRecordingByShareToken(recreatedToken)
    assert.equal(activeTokenLookup?.id, recording.id)
  })
})
