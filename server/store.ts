import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { nanoid } from 'nanoid'
import type { MultipartFile } from '@fastify/multipart'
import { storagePaths } from './config.js'
import { hashSharePassword } from './shareAccess.js'

export type Recording = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  fileName: string
  mimeType: string
  thumbnailFileName: string | null
  thumbnailMimeType: string | null
  sizeBytes: number
  durationMs: number | null
  durationSource: RecordingDurationSource
  shareToken: string | null
  shareExpiresAt: string | null
  shareWasRevoked: boolean
  shareDownloadEnabled: boolean
  sharePasswordHash: string | null
  sharePasswordSalt: string | null
  viewCount: number
}

export type RecordingDurationSource = 'media' | 'timer' | 'unknown'

export type ShareSettingsInput = {
  expiresAt?: string | null
  downloadEnabled?: boolean
  password?: string | null
}

export type ThumbnailUpload = {
  data: Buffer
  mimetype: string
}

type RecordingIndex = {
  recordings: Recording[]
}

type IndexRecovery = {
  backupPath: string
  recoveredAt: string
}

let lastIndexRecovery: IndexRecovery | null = null

export async function ensureStorage() {
  await mkdir(storagePaths.recordingsDir, { recursive: true })
  await mkdir(storagePaths.thumbnailsDir, { recursive: true })
  await mkdir(storagePaths.backupsDir, { recursive: true })
  await mkdir(storagePaths.indexBackupsDir, { recursive: true })

  try {
    await readFile(storagePaths.indexFile, 'utf8')
  } catch {
    await writeIndex({ recordings: [] })
  }
}

export async function listRecordings() {
  const index = await readIndex()
  return index.recordings.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function getRecording(id: string) {
  const index = await readIndex()
  return index.recordings.find((recording) => recording.id === id) ?? null
}

export async function getRecordingByShareToken(token: string) {
  const index = await readIndex()
  return index.recordings.find((recording) => recording.shareToken === token) ?? null
}

export async function saveRecording({
  file,
  title,
  durationMs,
  durationSource,
  thumbnail,
}: {
  file: MultipartFile
  title: string
  durationMs: number | null
  durationSource?: RecordingDurationSource
  thumbnail?: ThumbnailUpload | null
}) {
  await ensureStorage()

  const id = nanoid(12)
  const safeTitle = normalizeTitle(title)
  const fileName = `${id}-${safeTitle}.webm`
  const finalPath = path.join(storagePaths.recordingsDir, fileName)
  const tempPath = `${finalPath}.uploading`
  const storedThumbnail = normalizeThumbnailUpload(id, thumbnail)

  await mkdir(storagePaths.recordingsDir, { recursive: true })
  await pipeline(file.file, createWriteStream(tempPath))
  await rename(tempPath, finalPath)

  if (storedThumbnail) {
    await mkdir(storagePaths.thumbnailsDir, { recursive: true })
    const thumbnailPath = path.join(storagePaths.thumbnailsDir, storedThumbnail.fileName)
    await writeFile(thumbnailPath, storedThumbnail.data)
  }

  const fileStats = await stat(finalPath)
  const now = new Date().toISOString()
  const recording: Recording = {
    id,
    title: title.trim() || 'Untitled recording',
    createdAt: now,
    updatedAt: now,
    fileName,
    mimeType: file.mimetype || 'video/webm',
    thumbnailFileName: storedThumbnail?.fileName ?? null,
    thumbnailMimeType: storedThumbnail?.mimetype ?? null,
    sizeBytes: fileStats.size,
    durationMs,
    durationSource: normalizeDurationSource(durationSource, durationMs),
    shareToken: null,
    shareExpiresAt: null,
    shareWasRevoked: false,
    shareDownloadEnabled: true,
    sharePasswordHash: null,
    sharePasswordSalt: null,
    viewCount: 0,
  }

  const index = await readIndex()
  index.recordings.push(recording)
  await writeIndex(index)

  return recording
}

export async function updateRecording(id: string, updates: { title?: string }) {
  const index = await readIndex()
  const recording = index.recordings.find((item) => item.id === id)

  if (!recording) {
    return null
  }

  const title = updates.title?.trim()

  if (title) {
    recording.title = title
    recording.updatedAt = new Date().toISOString()
  }

  await writeIndex(index)
  return recording
}

export async function deleteRecording(id: string) {
  const index = await readIndex()
  const recordingIndex = index.recordings.findIndex((item) => item.id === id)

  if (recordingIndex === -1) {
    return null
  }

  const [recording] = index.recordings.splice(recordingIndex, 1)
  await writeIndex(index)

  try {
    const video = await getVideoFile(recording)
    await unlink(video.path)
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
  }

  try {
    const thumbnail = await getThumbnailFile(recording)
    if (thumbnail) {
      await unlink(thumbnail.path)
    }
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
  }

  return recording
}

export async function createShare(id: string, settings: ShareSettingsInput = {}) {
  const index = await readIndex()
  const recording = index.recordings.find((item) => item.id === id)

  if (!recording) {
    return null
  }

  if (!recording.shareToken) {
    recording.shareToken = nanoid(20)
  }

  recording.shareWasRevoked = false
  await applyShareSettings(recording, settings)
  recording.updatedAt = new Date().toISOString()
  await writeIndex(index)

  return recording
}

export async function revokeShare(id: string) {
  const index = await readIndex()
  const recording = index.recordings.find((item) => item.id === id)

  if (!recording) {
    return null
  }

  recording.shareToken = null
  recording.shareExpiresAt = null
  recording.shareWasRevoked = true
  recording.shareDownloadEnabled = true
  recording.sharePasswordHash = null
  recording.sharePasswordSalt = null
  recording.updatedAt = new Date().toISOString()
  await writeIndex(index)

  return recording
}

export async function recordShareView(token: string) {
  const index = await readIndex()
  const recording = index.recordings.find((item) => item.shareToken === token)

  if (!recording) {
    return null
  }

  recording.viewCount += 1
  recording.updatedAt = new Date().toISOString()
  await writeIndex(index)

  return recording
}

export async function getVideoFile(recording: Recording) {
  const filePath = path.join(storagePaths.recordingsDir, recording.fileName)
  const resolved = path.resolve(filePath)
  const recordingsRoot = path.resolve(storagePaths.recordingsDir)
  const normalizedResolved = resolved.toLowerCase()
  const normalizedRoot = recordingsRoot.toLowerCase()

  if (!normalizedResolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error('Recording file resolved outside the recordings root')
  }

  const fileStats = await stat(resolved)
  return {
    path: resolved,
    size: fileStats.size,
    stream: (start?: number, end?: number) => createReadStream(resolved, { start, end }),
  }
}

export async function getThumbnailFile(recording: Recording) {
  if (!recording.thumbnailFileName || !recording.thumbnailMimeType) {
    return null
  }

  const filePath = path.join(storagePaths.thumbnailsDir, recording.thumbnailFileName)
  const resolved = path.resolve(filePath)
  const thumbnailsRoot = path.resolve(storagePaths.thumbnailsDir)
  const normalizedResolved = resolved.toLowerCase()
  const normalizedRoot = thumbnailsRoot.toLowerCase()

  if (!normalizedResolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error('Recording thumbnail resolved outside the thumbnails root')
  }

  const fileStats = await stat(resolved)
  return {
    path: resolved,
    size: fileStats.size,
    mimeType: recording.thumbnailMimeType,
    stream: () => createReadStream(resolved),
  }
}

function publicRecording(recording: Recording) {
  return {
    id: recording.id,
    title: recording.title,
    createdAt: recording.createdAt,
    updatedAt: recording.updatedAt,
    mimeType: recording.mimeType,
    thumbnailUrl: recording.thumbnailFileName ? `/api/recordings/${recording.id}/thumbnail` : null,
    thumbnailMimeType: recording.thumbnailMimeType,
    sizeBytes: recording.sizeBytes,
    durationMs: recording.durationMs,
    durationSource: recording.durationSource,
    shareToken: recording.shareToken,
    shareExpiresAt: recording.shareExpiresAt,
    shareWasRevoked: recording.shareWasRevoked,
    shareDownloadEnabled: recording.shareDownloadEnabled,
    sharePasswordProtected: Boolean(recording.sharePasswordHash),
    shareExpired: isShareExpired(recording),
    viewCount: recording.viewCount,
  }
}

export function toPublicRecording(recording: Recording) {
  return publicRecording(recording)
}

async function readIndex(): Promise<RecordingIndex> {
  try {
    const source = await readFile(storagePaths.indexFile, 'utf8')
    const parsed = JSON.parse(source) as RecordingIndex
    return { recordings: (parsed.recordings ?? []).map(normalizeRecording) }
  } catch (error) {
    if (isMissingFileError(error)) {
      return { recordings: [] }
    }

    const recovery = await preserveCorruptIndex()
    lastIndexRecovery = recovery
    await writeIndex({ recordings: [] })
    return { recordings: [] }
  }
}

async function writeIndex(index: RecordingIndex) {
  await mkdir(path.dirname(storagePaths.indexFile), { recursive: true })
  const tempPath = `${storagePaths.indexFile}.tmp`
  await writeFile(tempPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  await rename(tempPath, storagePaths.indexFile)
}

function normalizeTitle(title: string) {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized.slice(0, 48) || 'recording'
}

async function preserveCorruptIndex() {
  await mkdir(storagePaths.indexBackupsDir, { recursive: true })
  const recoveredAt = new Date().toISOString()
  const safeTimestamp = recoveredAt.replace(/[:.]/g, '-')
  const backupPath = path.join(storagePaths.indexBackupsDir, `index-corrupt-${safeTimestamp}.json`)

  await copyFile(storagePaths.indexFile, backupPath)

  return {
    backupPath,
    recoveredAt,
  }
}

function normalizeThumbnailUpload(id: string, thumbnail: ThumbnailUpload | null | undefined) {
  if (!thumbnail?.data.length) {
    return null
  }

  const extension = getThumbnailExtension(thumbnail.mimetype)
  if (!extension) {
    return null
  }

  return {
    data: thumbnail.data,
    fileName: `${id}-poster.${extension}`,
    mimetype: thumbnail.mimetype,
  }
}

function getThumbnailExtension(mimetype: string) {
  const normalized = mimetype.toLowerCase()

  if (normalized === 'image/webp') {
    return 'webp'
  }

  if (normalized === 'image/png') {
    return 'png'
  }

  if (normalized === 'image/jpeg') {
    return 'jpg'
  }

  return null
}

async function applyShareSettings(recording: Recording, settings: ShareSettingsInput) {
  if ('expiresAt' in settings) {
    recording.shareExpiresAt = settings.expiresAt ?? null
  }

  if (typeof settings.downloadEnabled === 'boolean') {
    recording.shareDownloadEnabled = settings.downloadEnabled
  }

  if ('password' in settings) {
    const password = settings.password?.trim()

    if (password) {
      const { hash, salt } = await hashSharePassword(password)
      recording.sharePasswordHash = hash
      recording.sharePasswordSalt = salt
    } else if (settings.password === null || settings.password === '') {
      recording.sharePasswordHash = null
      recording.sharePasswordSalt = null
    }
  }
}

function normalizeRecording(recording: Recording) {
  return {
    ...recording,
    thumbnailFileName: recording.thumbnailFileName ?? null,
    thumbnailMimeType: recording.thumbnailMimeType ?? null,
    durationSource: normalizeDurationSource(recording.durationSource, recording.durationMs),
    shareExpiresAt: recording.shareExpiresAt ?? null,
    shareWasRevoked: Boolean(recording.shareWasRevoked),
    shareDownloadEnabled:
      typeof recording.shareDownloadEnabled === 'boolean' ? recording.shareDownloadEnabled : true,
    sharePasswordHash: recording.sharePasswordHash ?? null,
    sharePasswordSalt: recording.sharePasswordSalt ?? null,
    viewCount: recording.viewCount ?? 0,
  }
}

function normalizeDurationSource(value: unknown, durationMs: number | null): RecordingDurationSource {
  if (value === 'media' || value === 'timer' || value === 'unknown') {
    return value
  }

  return durationMs === null ? 'unknown' : 'timer'
}

export function isShareExpired(recording: Recording) {
  return Boolean(recording.shareExpiresAt && Date.parse(recording.shareExpiresAt) <= Date.now())
}

export function getLastIndexRecovery() {
  return lastIndexRecovery
}

function isMissingFileError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  )
}
