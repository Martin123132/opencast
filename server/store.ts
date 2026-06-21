import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
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
  sizeBytes: number
  durationMs: number | null
  shareToken: string | null
  shareExpiresAt: string | null
  shareDownloadEnabled: boolean
  sharePasswordHash: string | null
  sharePasswordSalt: string | null
  viewCount: number
}

export type ShareSettingsInput = {
  expiresAt?: string | null
  downloadEnabled?: boolean
  password?: string | null
}

type RecordingIndex = {
  recordings: Recording[]
}

export async function ensureStorage() {
  await mkdir(storagePaths.recordingsDir, { recursive: true })

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
}: {
  file: MultipartFile
  title: string
  durationMs: number | null
}) {
  await ensureStorage()

  const id = nanoid(12)
  const safeTitle = normalizeTitle(title)
  const fileName = `${id}-${safeTitle}.webm`
  const finalPath = path.join(storagePaths.recordingsDir, fileName)
  const tempPath = `${finalPath}.uploading`

  await pipeline(file.file, createWriteStream(tempPath))
  await rename(tempPath, finalPath)

  const fileStats = await stat(finalPath)
  const now = new Date().toISOString()
  const recording: Recording = {
    id,
    title: title.trim() || 'Untitled recording',
    createdAt: now,
    updatedAt: now,
    fileName,
    mimeType: file.mimetype || 'video/webm',
    sizeBytes: fileStats.size,
    durationMs,
    shareToken: null,
    shareExpiresAt: null,
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

export async function createShare(id: string, settings: ShareSettingsInput = {}) {
  const index = await readIndex()
  const recording = index.recordings.find((item) => item.id === id)

  if (!recording) {
    return null
  }

  if (!recording.shareToken) {
    recording.shareToken = nanoid(20)
  }

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

function publicRecording(recording: Recording) {
  return {
    id: recording.id,
    title: recording.title,
    createdAt: recording.createdAt,
    updatedAt: recording.updatedAt,
    mimeType: recording.mimeType,
    sizeBytes: recording.sizeBytes,
    durationMs: recording.durationMs,
    shareToken: recording.shareToken,
    shareExpiresAt: recording.shareExpiresAt,
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
  } catch {
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
    shareExpiresAt: recording.shareExpiresAt ?? null,
    shareDownloadEnabled:
      typeof recording.shareDownloadEnabled === 'boolean' ? recording.shareDownloadEnabled : true,
    sharePasswordHash: recording.sharePasswordHash ?? null,
    sharePasswordSalt: recording.sharePasswordSalt ?? null,
    viewCount: recording.viewCount ?? 0,
  }
}

export function isShareExpired(recording: Recording) {
  return Boolean(recording.shareExpiresAt && Date.parse(recording.shareExpiresAt) <= Date.now())
}
