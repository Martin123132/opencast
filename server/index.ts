import Fastify, { type FastifyReply } from 'fastify'
import multipart from '@fastify/multipart'
import staticFiles from '@fastify/static'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { appConfig, recordingGuardrails, runtimeTempRoot, storagePaths } from './config.js'
import {
  createShare,
  ensureStorage,
  getRecording,
  getRecordingByShareToken,
  getThumbnailFile,
  getVideoFile,
  isShareExpired,
  listRecordings,
  recordShareView,
  deleteRecording,
  revokeShare,
  updateRecording,
  type RecordingDurationSource,
  type ShareSettingsInput,
  type ThumbnailUpload,
  type Recording,
  saveRecording,
  toPublicRecording,
} from './store.js'
import {
  createShareAccessToken,
  verifyShareAccessToken,
  verifySharePassword,
} from './shareAccess.js'
import {
  createShareRateLimiter,
  type ShareRateLimitBlocked,
} from './shareRateLimit.js'
import { getStorageHealth } from './storageHealth.js'
import {
  createLibraryBackup,
  getLibraryBackupPreview,
  listLibraryBackups,
  restoreLibraryBackup,
} from './libraryBackup.js'
import {
  ensureRuntimeTempDirectory,
  isPackagedRuntime,
  openBrowser,
  resolveFreePort,
  resolveWebRoot,
  shouldOpenBrowser,
} from './runtime.js'

const app = Fastify({
  logger: true,
  bodyLimit: recordingGuardrails.maxRecordingBytes + recordingGuardrails.maxUploadOverheadBytes,
})
const webRoot = resolveWebRoot(import.meta.dirname)
const webIndexFile = path.join(webRoot, 'index.html')
const webBuildAvailable = await pathExists(webIndexFile)
const shareAccessLimiter = createShareRateLimiter()

await ensureRuntimeTempDirectory(runtimeTempRoot)
await ensureStorage()

app.addHook('onRequest', async (request, reply) => {
  applySecurityHeaders(reply)

  if (isPrivateResponsePath(request.url)) {
    reply.header('Cache-Control', 'no-store')
  }
})

if (webBuildAvailable) {
  await app.register(staticFiles, {
    root: webRoot,
    prefix: '/',
  })
}

await app.register(multipart, {
  limits: {
    files: 2,
    fileSize: recordingGuardrails.maxRecordingBytes,
  },
})

app.setErrorHandler((error, _, reply) => {
  if (isRecordingLimitError(error)) {
    return reply.code(413).send({
      error: `Recording is too large. Keep single recordings under ${formatServerBytes(
        recordingGuardrails.maxRecordingBytes,
      )}.`,
    })
  }

  return reply.send(error)
})

app.get('/api/health', async () => ({
  ok: true,
  dataRoot: appConfig.dataRoot,
  recordingsDir: storagePaths.recordingsDir,
}))

app.get('/api/config', async () => ({
  dataRoot: appConfig.dataRoot,
  recordingsDir: storagePaths.recordingsDir,
  backupsDir: storagePaths.backupsDir,
  requiredStorageDrive: appConfig.requiredStorageDrive,
  dataRootCompliant: true,
  recordingGuardrails,
  storageHealth: await getStorageHealth(),
}))

app.post('/api/backups', async (_, reply) => {
  const backup = await createLibraryBackup()
  return reply.code(201).send({ backup })
})

app.get('/api/backups', async () => ({
  backups: await listLibraryBackups(),
}))

app.get('/api/backups/:id', async (request, reply) => {
  const { id } = request.params as { id: string }
  const backup = await getLibraryBackupPreview(id)

  if (!backup) {
    return reply.code(404).send({ error: 'Backup not found' })
  }

  return { backup }
})

app.post('/api/backups/:id/restore', async (request, reply) => {
  const { id } = request.params as { id: string }
  const restore = await restoreLibraryBackup(id)

  if (!restore) {
    return reply.code(404).send({ error: 'Backup not found' })
  }

  if (restore.restoreStatus === 'unreadable') {
    return reply.code(422).send({ error: 'Backup index could not be read safely.' })
  }

  return {
    restore: {
      ...restore,
      importedRecordings: restore.importedRecordings.map(toPublicRecording),
    },
  }
})

app.get('/api/recordings', async () => {
  const recordings = await listRecordings()
  return { recordings: recordings.map(toPublicRecording) }
})

app.post('/api/recordings', async (request, reply) => {
  const parts = request.parts()
  let title = ''
  let durationMs: number | null = null
  let durationSource: RecordingDurationSource | undefined
  let thumbnail: ThumbnailUpload | null = null

  for await (const part of parts) {
    if (part.type === 'file') {
      if (part.fieldname === 'thumbnail') {
        thumbnail = await readThumbnailUpload(part)
        continue
      }

      if (part.fieldname !== 'video') {
        continue
      }

      const recording = await saveRecording({ file: part, title, durationMs, durationSource, thumbnail })
      return reply.code(201).send({ recording: toPublicRecording(recording) })
    }

    if (part.fieldname === 'title') {
      title = String(part.value ?? '')
    }

    if (part.fieldname === 'durationMs') {
      const parsed = Number(part.value)
      durationMs = Number.isFinite(parsed) ? parsed : null
    }

    if (part.fieldname === 'durationSource') {
      durationSource = parseDurationSource(part.value)
    }
  }

  return reply.code(400).send({ error: 'Missing recording upload' })
})

app.get('/api/recordings/:id/thumbnail', async (request, reply) => {
  const { id } = request.params as { id: string }
  const recording = await getRecording(id)

  if (!recording) {
    return reply.code(404).send({ error: 'Recording not found' })
  }

  const thumbnail = await getThumbnailFile(recording)

  if (!thumbnail) {
    return reply.code(404).send({ error: 'Recording thumbnail not found' })
  }

  return reply
    .header('Content-Type', thumbnail.mimeType)
    .header('Content-Length', thumbnail.size)
    .header('Cache-Control', 'no-store')
    .send(thumbnail.stream())
})

app.get('/api/recordings/:id', async (request, reply) => {
  const { id } = request.params as { id: string }
  const recording = await getRecording(id)

  if (!recording) {
    return reply.code(404).send({ error: 'Recording not found' })
  }

  return { recording: toPublicRecording(recording) }
})

app.patch('/api/recordings/:id', async (request, reply) => {
  const { id } = request.params as { id: string }
  const body = request.body as { title?: string } | undefined
  const recording = await updateRecording(id, { title: body?.title })

  if (!recording) {
    return reply.code(404).send({ error: 'Recording not found' })
  }

  return { recording: toPublicRecording(recording) }
})

app.delete('/api/recordings/:id', async (request, reply) => {
  const { id } = request.params as { id: string }
  const recording = await deleteRecording(id)

  if (!recording) {
    return reply.code(404).send({ error: 'Recording not found' })
  }

  return { recording: toPublicRecording(recording) }
})

app.post('/api/recordings/:id/share', async (request, reply) => {
  const { id } = request.params as { id: string }
  const recording = await createShare(id, parseShareSettings(request.body))

  if (!recording) {
    return reply.code(404).send({ error: 'Recording not found' })
  }

  return { recording: toPublicRecording(recording) }
})

app.delete('/api/recordings/:id/share', async (request, reply) => {
  const { id } = request.params as { id: string }
  const recording = await revokeShare(id)

  if (!recording) {
    return reply.code(404).send({ error: 'Recording not found' })
  }

  return { recording: toPublicRecording(recording) }
})

app.get('/api/recordings/:id/video', async (request, reply) => {
  const { id } = request.params as { id: string }
  const recording = await getRecording(id)

  if (!recording) {
    return reply.code(404).send({ error: 'Recording not found' })
  }

  return sendVideo(request.headers.range, reply, recording)
})

app.get('/api/shares/:token', async (request, reply) => {
  const { token } = request.params as { token: string }
  const recording = await getRecordingByShareToken(token)

  if (!recording) {
    return shareNotAvailable(reply, 404)
  }

  if (isShareExpired(recording)) {
    return shareNotAvailable(reply, 410)
  }

  const accessToken = getAccessToken(request.query)
  const hasAccess = await verifyShareAccessToken(recording, accessToken)

  if (!hasAccess) {
    return {
      requiresPassword: true,
      recording: null,
    }
  }

  return {
    requiresPassword: false,
    recording: toPublicRecording(recording),
  }
})

app.post('/api/shares/:token/access', async (request, reply) => {
  const { token } = request.params as { token: string }
  const recording = await getRecordingByShareToken(token)

  if (!recording) {
    return shareNotAvailable(reply, 404)
  }

  if (isShareExpired(recording)) {
    return shareNotAvailable(reply, 410)
  }

  const body = request.body as { password?: string } | undefined
  const password = body?.password ?? ''
  const rateLimitKey = getShareAccessRateLimitKey(request.ip, token)
  const rateLimitStatus = shareAccessLimiter.check(rateLimitKey)

  if (!rateLimitStatus.allowed) {
    return shareAccessRateLimited(reply, rateLimitStatus)
  }

  const passwordMatches = await verifySharePassword(recording, password)

  if (!passwordMatches) {
    const failureStatus = shareAccessLimiter.recordFailure(rateLimitKey)

    if (!failureStatus.allowed) {
      return shareAccessRateLimited(reply, failureStatus)
    }

    return reply.code(401).send({ error: 'Incorrect password' })
  }

  shareAccessLimiter.recordSuccess(rateLimitKey)
  const accessToken = await createShareAccessToken(recording)

  return {
    accessToken,
    recording: toPublicRecording(recording),
  }
})

app.get('/api/shares/:token/video', async (request, reply) => {
  const { token } = request.params as { token: string }
  const recording = await getRecordingByShareToken(token)

  if (!recording) {
    return shareNotAvailable(reply, 404)
  }

  if (isShareExpired(recording)) {
    return shareNotAvailable(reply, 410)
  }

  const hasAccess = await verifyShareAccessToken(recording, getAccessToken(request.query))

  if (!hasAccess) {
    return reply.code(401).send({ error: 'Password required' })
  }

  await recordShareView(token)
  return sendVideo(request.headers.range, reply, recording)
})

app.get('/api/shares/:token/download', async (request, reply) => {
  const { token } = request.params as { token: string }
  const recording = await getRecordingByShareToken(token)

  if (!recording) {
    return shareNotAvailable(reply, 404)
  }

  if (isShareExpired(recording)) {
    return shareNotAvailable(reply, 410)
  }

  if (!recording.shareDownloadEnabled) {
    return reply.code(403).send({ error: 'Downloads are disabled for this share' })
  }

  const hasAccess = await verifyShareAccessToken(recording, getAccessToken(request.query))

  if (!hasAccess) {
    return reply.code(401).send({ error: 'Password required' })
  }

  return sendVideo(request.headers.range, reply, recording, {
    attachmentFileName: recording.fileName,
  })
})

async function sendVideo(
  rangeHeader: string | undefined,
  reply: FastifyReply,
  recording: Recording | null,
  options: { attachmentFileName?: string } = {},
) {
  if (!recording) {
    return reply.code(404).send({ error: 'Recording not found' })
  }

  const video = await getVideoFile(recording)
  const contentType = recording.mimeType || 'video/webm'

  if (!rangeHeader) {
    const response = reply
      .header('Accept-Ranges', 'bytes')
      .header('Content-Type', contentType)
      .header('Cache-Control', 'no-store')
      .header('Content-Length', video.size)

    if (options.attachmentFileName) {
      response.header('Content-Disposition', `attachment; filename="${options.attachmentFileName}"`)
    }

    return response.send(video.stream())
  }

  const range = parseRange(rangeHeader, video.size)

  if (!range) {
    return reply
      .code(416)
      .header('Content-Range', `bytes */${video.size}`)
      .send()
  }

  const chunkSize = range.end - range.start + 1

  const response = reply
    .code(206)
    .header('Accept-Ranges', 'bytes')
    .header('Content-Type', contentType)
    .header('Cache-Control', 'no-store')
    .header('Content-Length', chunkSize)
    .header('Content-Range', `bytes ${range.start}-${range.end}/${video.size}`)

  if (options.attachmentFileName) {
    response.header('Content-Disposition', `attachment; filename="${options.attachmentFileName}"`)
  }

  return response.send(video.stream(range.start, range.end))
}

function shareNotAvailable(reply: FastifyReply, statusCode: number) {
  return reply.code(statusCode).send({ error: 'This share link is unavailable.' })
}

function shareAccessRateLimited(reply: FastifyReply, status: ShareRateLimitBlocked) {
  return reply
    .code(429)
    .header('Retry-After', status.retryAfterSeconds)
    .send({
      error: 'Too many password attempts. Wait before trying again.',
      retryAfterSeconds: status.retryAfterSeconds,
    })
}

function getShareAccessRateLimitKey(remoteAddress: string | undefined, token: string) {
  return `${remoteAddress ?? 'local'}:${token}`
}

function parseRange(rangeHeader: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader)

  if (!match) {
    return null
  }

  const start = match[1] ? Number(match[1]) : 0
  const end = match[2] ? Number(match[2]) : size - 1

  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || end >= size) {
    return null
  }

  return { start, end }
}

function parseShareSettings(source: unknown): ShareSettingsInput {
  const body = source as Partial<{
    expiresAt: string | null
    downloadEnabled: boolean
    password: string | null
  }> | null

  const settings: ShareSettingsInput = {}

  if (!body) {
    return settings
  }

  if ('expiresAt' in body) {
    settings.expiresAt = normalizeExpiry(body.expiresAt)
  }

  if (typeof body.downloadEnabled === 'boolean') {
    settings.downloadEnabled = body.downloadEnabled
  }

  if ('password' in body) {
    settings.password = body.password
  }

  return settings
}

async function readThumbnailUpload(part: { file: AsyncIterable<Buffer | Uint8Array>; mimetype: string }) {
  const chunks: Buffer[] = []

  for await (const chunk of part.file) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return {
    data: Buffer.concat(chunks),
    mimetype: part.mimetype || 'image/webp',
  }
}

function normalizeExpiry(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const timestamp = Date.parse(value)

  if (!Number.isFinite(timestamp)) {
    return null
  }

  return new Date(timestamp).toISOString()
}

function parseDurationSource(value: unknown): RecordingDurationSource | undefined {
  return value === 'media' || value === 'timer' || value === 'unknown' ? value : undefined
}

function getAccessToken(query: unknown) {
  const source = query as { accessToken?: string } | null
  return source?.accessToken
}

function applySecurityHeaders(reply: FastifyReply) {
  reply
    .header('X-Content-Type-Options', 'nosniff')
    .header('Referrer-Policy', 'no-referrer')
    .header('X-Frame-Options', 'DENY')
    .header('Cross-Origin-Opener-Policy', 'same-origin')
    .header('Cross-Origin-Resource-Policy', 'same-origin')
    .header('X-Permitted-Cross-Domain-Policies', 'none')
    .header(
      'Permissions-Policy',
      'camera=(self), microphone=(self), display-capture=(self), fullscreen=(self), clipboard-write=(self)',
    )
}

function isRecordingLimitError(error: unknown) {
  const source = error as {
    code?: string
    message?: string
    statusCode?: number
  }
  const message = source.message?.toLowerCase() ?? ''

  return (
    source.statusCode === 413 ||
    source.code === 'FST_REQ_FILE_TOO_LARGE' ||
    source.code === 'FST_ERR_CTP_BODY_TOO_LARGE' ||
    message.includes('file too large') ||
    message.includes('request body is too large')
  )
}

function formatServerBytes(value: number) {
  if (value >= 1024 * 1024 * 1024) {
    return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
  }

  if (value >= 1024 * 1024) {
    return `${Math.round(value / 1024 / 1024)} MB`
  }

  return `${Math.max(1, Math.round(value / 1024))} KB`
}

function isPrivateResponsePath(url: string) {
  return url.startsWith('/api/') || url === '/s' || url.startsWith('/s/')
}

app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/')) {
    return reply.code(404).send({ error: 'Route not found' })
  }

  if (!webBuildAvailable) {
    return reply.code(404).send({
      error: 'ShareFrame web build not found. Run npm.cmd run build before serving the app.',
    })
  }

  return reply.type('text/html').sendFile('index.html')
})

async function pathExists(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

try {
  const selectedPort = await resolveFreePort(appConfig.host, appConfig.port)
  const appUrl = `http://${appConfig.host}:${selectedPort}/`

  await app.listen({ host: appConfig.host, port: selectedPort })

  if (selectedPort !== appConfig.port) {
    app.log.info(`Port ${appConfig.port} is busy. ShareFrame is using ${selectedPort}.`)
  }

  if (isPackagedRuntime()) {
    process.stdout.write(
      [
        '',
        'ShareFrame is ready.',
        'No account required. Recordings stay on this machine.',
        `App:     ${appUrl}`,
        `Storage: ${appConfig.dataRoot}`,
        'Access:  Private until you create a guest link.',
        'Keep this window open while using ShareFrame. Close it to stop the app.',
        '',
      ].join('\n'),
    )
  }

  if (shouldOpenBrowser()) {
    openBrowser(appUrl)
  }
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
