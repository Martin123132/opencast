export type Recording = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  mimeType: string
  thumbnailUrl: string | null
  thumbnailMimeType: string | null
  sizeBytes: number
  durationMs: number | null
  durationSource: RecordingDurationSource
  shareToken: string | null
  shareExpiresAt: string | null
  shareWasRevoked: boolean
  shareDownloadEnabled: boolean
  sharePasswordProtected: boolean
  shareExpired: boolean
  viewCount: number
}

export type RecordingDurationSource = 'media' | 'timer' | 'unknown'

export type RecorderStatus =
  | 'idle'
  | 'requesting'
  | 'countdown'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'ready'
  | 'error'

export type AppConfig = {
  dataRoot: string
  recordingsDir: string
  backupsDir: string
  requiredStorageDrive: string
  dataRootCompliant: boolean
  storageHealth: StorageHealth
}

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
  status: 'complete' | 'partial' | 'unreadable'
}

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

export type ShareSettingsInput = {
  expiresAt?: string | null
  downloadEnabled?: boolean
  password?: string | null
}

export type SharedRecordingResponse = {
  requiresPassword: boolean
  recording: Recording | null
}

export type ShareAccessResponse = {
  accessToken: string
  recording: Recording
}
