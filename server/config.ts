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
  const resolved = path.win32.resolve(value)

  if (!isDDrivePath(resolved)) {
    throw new Error(`OPENCAST_DATA_ROOT must stay on D:. Refusing to use ${resolved}`)
  }

  return resolved
}

export function isDDrivePath(value: string) {
  return path.win32.resolve(value).toLowerCase().startsWith('d:\\')
}

export const storagePaths = {
  recordingsDir: path.join(appConfig.dataRoot, 'recordings'),
  indexFile: path.join(appConfig.dataRoot, 'index.json'),
  shareSecretFile: path.join(appConfig.dataRoot, 'share-secret.key'),
}
