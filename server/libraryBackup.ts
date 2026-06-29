import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { appConfig, storagePaths } from './config.js'
import {
  ensureStorage,
  getThumbnailFile,
  getVideoFile,
  importPrivateRecordingCopy,
  listRecordings,
  type Recording,
  type RecordingDurationSource,
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

export type LibraryBackupPreview = LibraryBackup & {
  restoreMode: 'preview-only'
  privacyNote: string
  recordings: Array<{
    id: string
    title: string
    fileName: string
    thumbnailFileName: string | null
    videoPresent: boolean
    thumbnailPresent: boolean | null
  }>
}

export type LibraryBackupRestore = {
  backup: LibraryBackupPreview
  restoreMode: 'private-copy'
  restoreStatus: 'complete' | 'partial' | 'unreadable'
  importedRecordingCount: number
  skippedRecordingCount: number
  importedRecordings: Recording[]
  privacyNote: string
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

type BackupIndex = {
  recordings?: BackupRecording[]
}

type BackupRecording = Partial<
  Pick<
    Recording,
    | 'id'
    | 'title'
    | 'fileName'
    | 'mimeType'
    | 'thumbnailFileName'
    | 'thumbnailMimeType'
    | 'durationMs'
    | 'durationSource'
  >
>

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

export async function getLibraryBackupPreview(id: string): Promise<LibraryBackupPreview | null> {
  await ensureStorage()

  const backupRoot = assertInsideDataRoot(path.join(storagePaths.backupsDir, id))

  try {
    const backupStats = await stat(backupRoot)

    if (!backupStats.isDirectory()) {
      return null
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    throw error
  }

  return readLibraryBackupPreview(backupRoot, id)
}

export async function restoreLibraryBackup(id: string): Promise<LibraryBackupRestore | null> {
  const preview = await getLibraryBackupPreview(id)

  if (!preview) {
    return null
  }

  if (preview.status === 'unreadable') {
    return buildRestoreResult(preview, [], preview.recordingCount, 'unreadable')
  }

  const backupRoot = assertInsideDataRoot(path.join(storagePaths.backupsDir, id))
  const backupIndex = await readBackupIndex(backupRoot)

  if (!backupIndex) {
    return buildRestoreResult(preview, [], preview.recordingCount, 'unreadable')
  }

  const importedRecordings: Recording[] = []
  let skippedRecordingCount = 0
  const backupRecordings = backupIndex.recordings ?? []

  for (const recording of backupRecordings) {
    const restored = await restoreBackupRecording(backupRoot, recording)

    if (restored) {
      importedRecordings.push(restored)
    } else {
      skippedRecordingCount += 1
    }
  }

  skippedRecordingCount += Math.max(0, preview.recordingCount - backupRecordings.length)

  const restoreStatus =
    skippedRecordingCount || preview.missingRecordingFiles || preview.missingThumbnailFiles
      ? 'partial'
      : 'complete'

  return buildRestoreResult(preview, importedRecordings, skippedRecordingCount, restoreStatus)
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

async function readBackupIndex(backupRoot: string): Promise<BackupIndex | null> {
  const safeBackupRoot = assertInsideDataRoot(backupRoot)

  try {
    const source = await readFile(path.join(safeBackupRoot, 'index.json'), 'utf8')
    const parsed = JSON.parse(source) as BackupIndex

    return {
      recordings: Array.isArray(parsed.recordings) ? parsed.recordings : [],
    }
  } catch {
    return null
  }
}

async function restoreBackupRecording(backupRoot: string, recording: BackupRecording) {
  const fileName = typeof recording.fileName === 'string' ? path.basename(recording.fileName) : ''

  if (!fileName) {
    return null
  }

  const sourceVideoPath = path.join(backupRoot, 'recordings', fileName)

  if (!(await pathExists(sourceVideoPath))) {
    return null
  }

  const thumbnailSource = await getRestoreThumbnailSource(backupRoot, recording)

  return importPrivateRecordingCopy({
    title: typeof recording.title === 'string' ? recording.title : 'Restored recording',
    sourceVideoPath,
    sourceFileName: fileName,
    mimeType: typeof recording.mimeType === 'string' ? recording.mimeType : 'video/webm',
    sourceThumbnailPath: thumbnailSource?.path ?? null,
    thumbnailMimeType:
      thumbnailSource && typeof recording.thumbnailMimeType === 'string'
        ? recording.thumbnailMimeType
        : null,
    durationMs: typeof recording.durationMs === 'number' ? recording.durationMs : null,
    durationSource: normalizeRestoreDurationSource(recording.durationSource),
  })
}

async function getRestoreThumbnailSource(backupRoot: string, recording: BackupRecording) {
  const thumbnailFileName =
    typeof recording.thumbnailFileName === 'string' ? path.basename(recording.thumbnailFileName) : ''

  if (!thumbnailFileName || typeof recording.thumbnailMimeType !== 'string') {
    return null
  }

  const thumbnailPath = path.join(backupRoot, 'thumbnails', thumbnailFileName)

  if (!(await pathExists(thumbnailPath))) {
    return null
  }

  return {
    path: thumbnailPath,
  }
}

function normalizeRestoreDurationSource(value: unknown): RecordingDurationSource | null {
  return value === 'media' || value === 'timer' || value === 'unknown' ? value : null
}

function buildRestoreResult(
  backup: LibraryBackupPreview,
  importedRecordings: Recording[],
  skippedRecordingCount: number,
  restoreStatus: LibraryBackupRestore['restoreStatus'],
): LibraryBackupRestore {
  return {
    backup,
    restoreMode: 'private-copy',
    restoreStatus,
    importedRecordingCount: importedRecordings.length,
    skippedRecordingCount,
    importedRecordings,
    privacyNote:
      'Restored recordings were imported as private local copies. Old public links, passwords, expiry settings, and view counts were not restored.',
  }
}

async function readLibraryBackupPreview(
  backupRoot: string,
  fallbackId: string,
): Promise<LibraryBackupPreview> {
  const safeBackupRoot = assertInsideDataRoot(backupRoot)
  const manifestPath = path.join(safeBackupRoot, 'manifest.json')

  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Partial<BackupManifest>
    const id = manifest.id ?? fallbackId
    const createdAt = manifest.createdAt ?? createdAtFromBackupId(fallbackId)
    const recordings = Array.isArray(manifest.recordings) ? manifest.recordings : []
    const previewRecordings = await Promise.all(
      recordings.map((recording) => readBackupRecordingPreview(safeBackupRoot, recording)),
    )
    const verified = getPreviewFileCounts(previewRecordings)
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
      recordingCount: Number(manifest.recordingCount ?? previewRecordings.length),
      copiedRecordingFiles: verified.copiedRecordingFiles,
      copiedThumbnailFiles: verified.copiedThumbnailFiles,
      missingRecordingFiles: verified.missingRecordingFiles,
      missingThumbnailFiles: verified.missingThumbnailFiles,
      status,
      restoreMode: 'preview-only',
      privacyNote:
        'Restoring imports recordings as private copies and must not reactivate old public share links.',
      recordings: previewRecordings,
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
      restoreMode: 'preview-only',
      privacyNote:
        'This backup manifest could not be read, so restore is blocked until the backup is reviewed.',
      recordings: [],
    }
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

async function readBackupRecordingPreview(
  backupRoot: string,
  recording: {
    id?: string
    title?: string
    fileName?: string
    thumbnailFileName?: string | null
  },
) {
  const videoPresent = recording.fileName
    ? await pathExists(path.join(backupRoot, 'recordings', path.basename(recording.fileName)))
    : false
  const thumbnailPresent = recording.thumbnailFileName
    ? await pathExists(path.join(backupRoot, 'thumbnails', path.basename(recording.thumbnailFileName)))
    : null

  return {
    id: recording.id ?? '',
    title: recording.title ?? 'Untitled recording',
    fileName: recording.fileName ? path.basename(recording.fileName) : '',
    thumbnailFileName: recording.thumbnailFileName ? path.basename(recording.thumbnailFileName) : null,
    videoPresent,
    thumbnailPresent,
  }
}

function getPreviewFileCounts(
  recordings: Array<{
    videoPresent: boolean
    thumbnailPresent: boolean | null
  }>,
) {
  return recordings.reduce(
    (totals, recording) => {
      if (recording.videoPresent) {
        totals.copiedRecordingFiles += 1
      } else {
        totals.missingRecordingFiles += 1
      }

      if (recording.thumbnailPresent === true) {
        totals.copiedThumbnailFiles += 1
      } else if (recording.thumbnailPresent === false) {
        totals.missingThumbnailFiles += 1
      }

      return totals
    },
    {
      copiedRecordingFiles: 0,
      copiedThumbnailFiles: 0,
      missingRecordingFiles: 0,
      missingThumbnailFiles: 0,
    },
  )
}

async function pathExists(targetPath: string) {
  try {
    await stat(targetPath)
    return true
  } catch (error) {
    if (isMissingFileError(error)) {
      return false
    }

    throw error
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
