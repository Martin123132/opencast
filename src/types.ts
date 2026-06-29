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
  shareToken: string | null
  shareExpiresAt: string | null
  shareWasRevoked: boolean
  shareDownloadEnabled: boolean
  sharePasswordProtected: boolean
  shareExpired: boolean
  viewCount: number
}

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
