import type {
  Recording,
  ShareAccessResponse,
  SharedRecordingResponse,
  ShareSettingsInput,
} from './types'

type RecordingsResponse = {
  recordings: Recording[]
}

type RecordingResponse = {
  recording: Recording
}

export async function fetchRecordings() {
  const response = await fetch('/api/recordings')
  const body = await readJson<RecordingsResponse>(response)
  return body.recordings
}

export async function fetchSharedRecording(token: string, accessToken?: string) {
  const response = await fetch(
    `/api/shares/${token}${accessToken ? `?accessToken=${encodeURIComponent(accessToken)}` : ''}`,
  )
  return readJson<SharedRecordingResponse>(response)
}

export async function uploadRecording({
  blob,
  title,
  durationMs,
}: {
  blob: Blob
  title: string
  durationMs: number | null
}) {
  const form = new FormData()
  form.append('title', title)
  form.append('durationMs', String(durationMs ?? ''))
  form.append('video', blob, `${normalizeFileName(title)}.webm`)

  const response = await fetch('/api/recordings', {
    method: 'POST',
    body: form,
  })
  const body = await readJson<RecordingResponse>(response)
  return body.recording
}

export async function createShare(id: string, settings: ShareSettingsInput = {}) {
  const response = await fetch(`/api/recordings/${id}/share`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })
  const body = await readJson<RecordingResponse>(response)
  return body.recording
}

export async function revokeShare(id: string) {
  const response = await fetch(`/api/recordings/${id}/share`, {
    method: 'DELETE',
  })
  const body = await readJson<RecordingResponse>(response)
  return body.recording
}

export async function requestShareAccess(token: string, password: string) {
  const response = await fetch(`/api/shares/${token}/access`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  })
  return readJson<ShareAccessResponse>(response)
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string }

  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with ${response.status}`)
  }

  return body
}

function normalizeFileName(title: string) {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'recording'
  )
}
