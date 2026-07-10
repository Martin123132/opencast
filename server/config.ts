import { assertDDrivePath, isDDrivePath as isDDriveStoragePath } from '../scripts/path-guards.js'
import path from 'node:path'
import { configureRuntimeEnvironment, getDefaultDataRoot } from './runtime.js'

export const runtimeTempRoot = configureRuntimeEnvironment()
const defaultDataRoot = getDefaultDataRoot()
const requiredStorageDrive = 'D:'
const defaultMaxRecordingBytes = 2 * 1024 * 1024 * 1024
const defaultUploadOverheadBytes = 16 * 1024 * 1024
const defaultStorageWarningThresholdBytes = 5 * 1024 * 1024 * 1024
const defaultLongRecordingWarningMs = 60 * 60 * 1000

export const appConfig = {
  host: process.env.OPENCAST_HOST ?? '127.0.0.1',
  port: Number(process.env.OPENCAST_PORT ?? 4174),
  dataRoot: resolveDataRoot(process.env.OPENCAST_DATA_ROOT ?? defaultDataRoot),
  requiredStorageDrive,
}

export const recordingGuardrails = {
  maxRecordingBytes: parsePositiveInteger(
    process.env.OPENCAST_MAX_RECORDING_BYTES,
    defaultMaxRecordingBytes,
  ),
  maxUploadOverheadBytes: parsePositiveInteger(
    process.env.OPENCAST_MAX_UPLOAD_OVERHEAD_BYTES,
    defaultUploadOverheadBytes,
  ),
  storageWarningThresholdBytes: parsePositiveInteger(
    process.env.OPENCAST_STORAGE_WARNING_BYTES,
    defaultStorageWarningThresholdBytes,
  ),
  longRecordingWarningMs: parsePositiveInteger(
    process.env.OPENCAST_LONG_RECORDING_WARNING_MS,
    defaultLongRecordingWarningMs,
  ),
}

export function getRecordingSizeStatus(sizeBytes: number, maxBytes = recordingGuardrails.maxRecordingBytes) {
  return sizeBytes > maxBytes ? 'too-large' : 'ready'
}

export function resolveDataRoot(value: string) {
  const resolved = assertDDrivePath(value, 'OPENCAST_DATA_ROOT')

  return resolved
}

export function isDDrivePath(value: string) {
  return isDDriveStoragePath(value)
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export const storagePaths = {
  recordingsDir: path.join(appConfig.dataRoot, 'recordings'),
  thumbnailsDir: path.join(appConfig.dataRoot, 'thumbnails'),
  backupsDir: path.join(appConfig.dataRoot, 'backups'),
  indexFile: path.join(appConfig.dataRoot, 'index.json'),
  indexBackupsDir: path.join(appConfig.dataRoot, 'index-backups'),
  shareSecretFile: path.join(appConfig.dataRoot, 'share-secret.key'),
}
