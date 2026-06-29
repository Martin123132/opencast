import { statfs } from 'node:fs/promises'
import { appConfig } from './config.js'
import {
  getLastIndexRecovery,
  getThumbnailFile,
  getVideoFile,
  listRecordings,
  type Recording,
} from './store.js'

export const storageWarningThresholdBytes = 5 * 1024 * 1024 * 1024

export type StorageHealth = {
  disk: {
    status: 'ready' | 'low-space' | 'unknown'
    freeBytes: number | null
    totalBytes: number | null
    warningThresholdBytes: number
  }
  library: {
    status: 'ready' | 'recovered' | 'needs-attention' | 'unreadable'
    recordingCount: number
    missingRecordingFiles: number
    missingThumbnailFiles: number
    indexRecoveredAt: string | null
    indexBackupPath: string | null
  }
}

export async function getStorageHealth(): Promise<StorageHealth> {
  const [disk, library] = await Promise.all([getDiskHealth(), getLibraryHealth()])

  return { disk, library }
}

async function getDiskHealth(): Promise<StorageHealth['disk']> {
  try {
    const diskStats = await statfs(appConfig.dataRoot)
    const freeBytes = diskStats.bavail * diskStats.bsize
    const totalBytes = diskStats.blocks * diskStats.bsize

    return {
      status: getDiskStatus(freeBytes, storageWarningThresholdBytes),
      freeBytes,
      totalBytes,
      warningThresholdBytes: storageWarningThresholdBytes,
    }
  } catch {
    return {
      status: 'unknown',
      freeBytes: null,
      totalBytes: null,
      warningThresholdBytes: storageWarningThresholdBytes,
    }
  }
}

async function getLibraryHealth(): Promise<StorageHealth['library']> {
  try {
    const recordings = await listRecordings()
    const fileHealth = await getRecordingFileHealth(recordings)
    const recovery = getLastIndexRecovery()
    const status = getLibraryStatus(fileHealth, recovery)

    return {
      status,
      recordingCount: recordings.length,
      missingRecordingFiles: fileHealth.missingRecordingFiles,
      missingThumbnailFiles: fileHealth.missingThumbnailFiles,
      indexRecoveredAt: recovery?.recoveredAt ?? null,
      indexBackupPath: recovery?.backupPath ?? null,
    }
  } catch {
    return {
      status: 'unreadable',
      recordingCount: 0,
      missingRecordingFiles: 0,
      missingThumbnailFiles: 0,
      indexRecoveredAt: null,
      indexBackupPath: null,
    }
  }
}

async function getRecordingFileHealth(recordings: Recording[]) {
  let missingRecordingFiles = 0
  let missingThumbnailFiles = 0

  await Promise.all(
    recordings.map(async (recording) => {
      try {
        await getVideoFile(recording)
      } catch (error) {
        if (isMissingFileError(error)) {
          missingRecordingFiles += 1
        } else {
          throw error
        }
      }

      try {
        await getThumbnailFile(recording)
      } catch (error) {
        if (isMissingFileError(error)) {
          missingThumbnailFiles += 1
        } else {
          throw error
        }
      }
    }),
  )

  return {
    missingRecordingFiles,
    missingThumbnailFiles,
  }
}

export function getDiskStatus(freeBytes: number, thresholdBytes = storageWarningThresholdBytes) {
  return freeBytes < thresholdBytes ? 'low-space' : 'ready'
}

function getLibraryStatus(
  fileHealth: { missingRecordingFiles: number; missingThumbnailFiles: number },
  recovery: ReturnType<typeof getLastIndexRecovery>,
): StorageHealth['library']['status'] {
  if (recovery) {
    return 'recovered'
  }

  if (fileHealth.missingRecordingFiles || fileHealth.missingThumbnailFiles) {
    return 'needs-attention'
  }

  return 'ready'
}

function isMissingFileError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  )
}
