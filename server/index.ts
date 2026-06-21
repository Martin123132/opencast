import Fastify, { type FastifyReply } from 'fastify'
import multipart from '@fastify/multipart'
import { appConfig, storagePaths } from './config.js'
import {
  createShare,
  ensureStorage,
  getRecording,
  getRecordingByShareToken,
  getVideoFile,
  isShareExpired,
  listRecordings,
  recordShareView,
  revokeShare,
  type ShareSettingsInput,
  type Recording,
  saveRecording,
  toPublicRecording,
} from './store.js'
import {
  createShareAccessToken,
  verifyShareAccessToken,
  verifySharePassword,
} from './shareAccess.js'

const app = Fastify({
  logger: true,
  bodyLimit: 1024 * 1024 * 1024 * 2,
})

await ensureStorage()

await app.register(multipart, {
  limits: {
    files: 1,
    fileSize: 1024 * 1024 * 1024 * 2,
  },
})

app.get('/api/health', async () => ({
  ok: true,
  dataRoot: appConfig.dataRoot,
  recordingsDir: storagePaths.recordingsDir,
}))

app.get('/api/config', async () => ({
  dataRoot: appConfig.dataRoot,
  recordingsDir: storagePaths.recordingsDir,
}))

app.get('/api/recordings', async () => {
  const recordings = await listRecordings()
  return { recordings: recordings.map(toPublicRecording) }
})

app.post('/api/recordings', async (request, reply) => {
  const parts = request.parts()
  let title = ''
  let durationMs: number | null = null

  for await (const part of parts) {
    if (part.type === 'file') {
      const recording = await saveRecording({ file: part, title, durationMs })
      return reply.code(201).send({ recording: toPublicRecording(recording) })
    }

    if (part.fieldname === 'title') {
      title = String(part.value ?? '')
    }

    if (part.fieldname === 'durationMs') {
      const parsed = Number(part.value)
      durationMs = Number.isFinite(parsed) ? parsed : null
    }
  }

  return reply.code(400).send({ error: 'Missing recording upload' })
})

app.get('/api/recordings/:id', async (request, reply) => {
  const { id } = request.params as { id: string }
  const recording = await getRecording(id)

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
    return reply.code(404).send({ error: 'Share not found' })
  }

  if (isShareExpired(recording)) {
    return reply.code(410).send({ error: 'Share link expired' })
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
    return reply.code(404).send({ error: 'Share not found' })
  }

  if (isShareExpired(recording)) {
    return reply.code(410).send({ error: 'Share link expired' })
  }

  const body = request.body as { password?: string } | undefined
  const password = body?.password ?? ''
  const passwordMatches = await verifySharePassword(recording, password)

  if (!passwordMatches) {
    return reply.code(401).send({ error: 'Incorrect password' })
  }

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
    return reply.code(404).send({ error: 'Share not found' })
  }

  if (isShareExpired(recording)) {
    return reply.code(410).send({ error: 'Share link expired' })
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
    return reply.code(404).send({ error: 'Share not found' })
  }

  if (isShareExpired(recording)) {
    return reply.code(410).send({ error: 'Share link expired' })
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
    .header('Content-Length', chunkSize)
    .header('Content-Range', `bytes ${range.start}-${range.end}/${video.size}`)

  if (options.attachmentFileName) {
    response.header('Content-Disposition', `attachment; filename="${options.attachmentFileName}"`)
  }

  return response.send(video.stream(range.start, range.end))
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

function getAccessToken(query: unknown) {
  const source = query as { accessToken?: string } | null
  return source?.accessToken
}

try {
  await app.listen({ host: appConfig.host, port: appConfig.port })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
