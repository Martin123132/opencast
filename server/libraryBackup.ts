import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
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
  status: LibraryBackupStatus
}

export type LibraryBackupStatus = 'complete' | 'partial' | 'unreadable'

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

export async function listLibraryBackups(): Promise<LibraryBackup[]> {
  await ensureStorage()

  const entries = await readBackupDirectory()
  const backups = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => readLibraryBackup(path.join(storagePaths.backupsDir, entry.name), entry.name)),
  )

  return backups.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
}

async function readBackupDirectory() {
  try {
    return await readdir(storagePaths.backupsDir, { withFileTypes: true })
  } catch (error) {
    if (isMissingFileError(error)) {
      return []
    }

    throw error
  }
}

async function readLibraryBackup(backupRoot: string, fallbackId: string): Promise<LibraryBackup> {
  const safeBackupRoot = assertInsideDataRoot(backupRoot)
  const manifestPath = path.join(safeBackupRoot, 'manifest.json')

  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Partial<BackupManifest>
    const id = manifest.id ?? fallbackId
    const createdAt = manifest.createdAt ?? createdAtFromBackupId(fallbackId)
    const recordings = Array.isArray(manifest.recordings) ? manifest.recordings : []
    const verified = await verifyBackupFiles(safeBackupRoot, recordings)
    const manifestStatus = manifest.status === 'partial' ? 'partial' : 'complete'
    const status =
      manifestStatus === 'partial' ||
      verified.missingRecordingFiles ||
      verified.missingThumbnailFiles
        ? 'partial'
        : 'complete'

    return {
      id,
      createdAt,
      path: safeBackupRoot,
      indexPath: path.join(safeBackupRoot, 'index.json'),
      manifestPath,
      recordingCount: Number(manifest.recordingCount ?? recordings.length),
      copiedRecordingFiles: verified.copiedRecordingFiles,
      copiedThumbnailFiles: verified.copiedThumbnailFiles,
      missingRecordingFiles: verified.missingRecordingFiles,
      missingThumbnailFiles: verified.missingThumbnailFiles,
      status,
    }
  } catch {
    return {
      id: fallbackId,
      createdAt: createdAtFromBackupId(fallbackId),
      path: safeBackupRoot,
      indexPath: path.join(safeBackupRoot, 'index.json'),
      manifestPath,
      recordingCount: 0,
      copiedRecordingFiles: 0,
      copiedThumbnailFiles: 0,
      missingRecordingFiles: 0,
      missingThumbnailFiles: 0,
      status: 'unreadable',
    }
  }
}

async function verifyBackupFiles(
  backupRoot: string,
  recordings: Array<{
    fileName?: string
    thumbnailFileName?: string | null
  }>,
) {
  let copiedRecordingFiles = 0
  let copiedThumbnailFiles = 0
  let missingRecordingFiles = 0
  let missingThumbnailFiles = 0

  for (const recording of recordings) {
    if (recording.fileName) {
      try {
        await stat(path.join(backupRoot, 'recordings', path.basename(recording.fileName)))
        copiedRecordingFiles += 1
      } catch (error) {
        if (!isMissingFileError(error)) {
          throw error
        }

        missingRecordingFiles += 1
      }
    }

    if (!recording.thumbnailFileName) {
      continue
    }

    try {
      await stat(path.join(backupRoot, 'thumbnails', path.basename(recording.thumbnailFileName)))
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

function createdAtFromBackupId(id: string) {
  const timestamp = id.replace(/^shareframe-backup-/, '')
  const match = /^(\d{4}-\d{2}-\d{2}T)(\d{2})-(\d{2})-(\d{2})-(\d{3}Z)$/.exec(timestamp)

  if (!match) {
    return new Date(0).toISOString()
  }

  return `${match[1]}${match[2]}:${match[3]}:${match[4]}.${match[5]}`
}

function isMissingFileError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  )
}
