import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { appConfig, storagePaths } from './config.js'
import {
  ensureStorage,
  getThumbnailFile,
  getVideoFile,
  listRecordings,
  type Recording,
} from './store.js'

export type LibraryBackup = {
  id: string
  createdAt: string
  path: string
  indexPath: string
  manifestPath: string
  recordingCount: number
  copiedRecordingFiles: number
  copiedThumbnailFiles: number
  missingRecordingFiles: number
  missingThumbnailFiles: number
  status: 'complete' | 'partial'
}

type BackupManifest = LibraryBackup & {
  schemaVersion: 1
  dataRoot: string
  recordingsDir: string
  thumbnailsDir: string
  recordings: Array<{
    id: string
    title: string
    fileName: string
    thumbnailFileName: string | null
  }>
}

export async function createLibraryBackup(): Promise<LibraryBackup> {
  await ensureStorage()

  const createdAt = new Date().toISOString()
  const id = `shareframe-backup-${createdAt.replace(/[:.]/g, '-')}`
  const backupRoot = assertInsideDataRoot(path.join(storagePaths.backupsDir, id))
  const recordingsBackupDir = path.join(backupRoot, 'recordings')
  const thumbnailsBackupDir = path.join(backupRoot, 'thumbnails')
  const indexPath = path.join(backupRoot, 'index.json')
  const manifestPath = path.join(backupRoot, 'manifest.json')

  await mkdir(recordingsBackupDir, { recursive: true })
  await mkdir(thumbnailsBackupDir, { recursive: true })
  await copyFile(storagePaths.indexFile, indexPath)

  const recordings = await listRecordings()
  const result = await copyRecordingAssets(recordings, recordingsBackupDir, thumbnailsBackupDir)
  const status =
    result.missingRecordingFiles || result.missingThumbnailFiles ? 'partial' : 'complete'
  const backup: LibraryBackup = {
    id,
    createdAt,
    path: backupRoot,
    indexPath,
    manifestPath,
    recordingCount: recordings.length,
    copiedRecordingFiles: result.copiedRecordingFiles,
    copiedThumbnailFiles: result.copiedThumbnailFiles,
    missingRecordingFiles: result.missingRecordingFiles,
    missingThumbnailFiles: result.missingThumbnailFiles,
    status,
  }
  const manifest: BackupManifest = {
    ...backup,
    schemaVersion: 1,
    dataRoot: appConfig.dataRoot,
    recordingsDir: storagePaths.recordingsDir,
    thumbnailsDir: storagePaths.thumbnailsDir,
    recordings: recordings.map((recording) => ({
      id: recording.id,
      title: recording.title,
      fileName: recording.fileName,
      thumbnailFileName: recording.thumbnailFileName,
    })),
  }

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  return backup
}

async function copyRecordingAssets(
  recordings: Recording[],
  recordingsBackupDir: string,
  thumbnailsBackupDir: string,
) {
  let copiedRecordingFiles = 0
  let copiedThumbnailFiles = 0
  let missingRecordingFiles = 0
  let missingThumbnailFiles = 0

  for (const recording of recordings) {
    try {
      const video = await getVideoFile(recording)
      await copyFile(video.path, path.join(recordingsBackupDir, path.basename(recording.fileName)))
      copiedRecordingFiles += 1
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error
      }

      missingRecordingFiles += 1
    }

    if (!recording.thumbnailFileName) {
      continue
    }

    try {
      const thumbnail = await getThumbnailFile(recording)

      if (!thumbnail) {
        missingThumbnailFiles += 1
        continue
      }

      await copyFile(
        thumbnail.path,
        path.join(thumbnailsBackupDir, path.basename(recording.thumbnailFileName)),
      )
      copiedThumbnailFiles += 1
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error
      }

      missingThumbnailFiles += 1
    }
  }

  return {
    copiedRecordingFiles,
    copiedThumbnailFiles,
    missingRecordingFiles,
    missingThumbnailFiles,
  }
}

function assertInsideDataRoot(targetPath: string) {
  const resolved = path.resolve(targetPath)
  const root = path.resolve(appConfig.dataRoot)

  if (!resolved.toLowerCase().startsWith(`${root.toLowerCase()}${path.sep}`)) {
    throw new Error('Backup path resolved outside the data root')
  }

  return resolved
}

function isMissingFileError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  )
}
