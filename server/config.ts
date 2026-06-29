import { assertDDrivePath, isDDrivePath as isDDriveStoragePath } from '../scripts/path-guards'
import path from 'node:path'

const defaultDataRoot = 'D:\\open-source\\opencast-data'
const requiredStorageDrive = 'D:'

export const appConfig = {
  host: process.env.OPENCAST_HOST ?? '127.0.0.1',
  port: Number(process.env.OPENCAST_PORT ?? 4174),
  dataRoot: resolveDataRoot(process.env.OPENCAST_DATA_ROOT ?? defaultDataRoot),
  requiredStorageDrive,
}

export function resolveDataRoot(value: string) {
  const resolved = assertDDrivePath(value, 'OPENCAST_DATA_ROOT')

  return resolved
}

export function isDDrivePath(value: string) {
  return isDDriveStoragePath(value)
}

export const storagePaths = {
  recordingsDir: path.join(appConfig.dataRoot, 'recordings'),
  thumbnailsDir: path.join(appConfig.dataRoot, 'thumbnails'),
  backupsDir: path.join(appConfig.dataRoot, 'backups'),
  indexFile: path.join(appConfig.dataRoot, 'index.json'),
  indexBackupsDir: path.join(appConfig.dataRoot, 'index-backups'),
  shareSecretFile: path.join(appConfig.dataRoot, 'share-secret.key'),
}
