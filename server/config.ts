import path from 'node:path'

const defaultDataRoot = 'D:\\open-source\\opencast-data'

export const appConfig = {
  host: process.env.OPENCAST_HOST ?? '127.0.0.1',
  port: Number(process.env.OPENCAST_PORT ?? 4174),
  dataRoot: path.resolve(process.env.OPENCAST_DATA_ROOT ?? defaultDataRoot),
}

const normalizedDataRoot = appConfig.dataRoot.toLowerCase()

if (!normalizedDataRoot.startsWith('d:\\')) {
  throw new Error(
    `OPENCAST_DATA_ROOT must stay on D:. Refusing to use ${appConfig.dataRoot}`,
  )
}

export const storagePaths = {
  recordingsDir: path.join(appConfig.dataRoot, 'recordings'),
  indexFile: path.join(appConfig.dataRoot, 'index.json'),
  shareSecretFile: path.join(appConfig.dataRoot, 'share-secret.key'),
}
