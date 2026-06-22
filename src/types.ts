export type Recording = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  mimeType: string
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
