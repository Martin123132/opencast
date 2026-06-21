import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  Camera,
  Check,
  Clock,
  Copy,
  Download,
  HardDrive,
  Link2,
  Lock,
  Mic,
  MonitorUp,
  Pause,
  Play,
  RefreshCcw,
  Save,
  Square,
  Trash2,
  UploadCloud,
  Video,
} from 'lucide-react'
import './App.css'
import {
  createShare,
  fetchRecordings,
  fetchSharedRecording,
  requestShareAccess,
  revokeShare,
  uploadRecording,
} from './api'
import type { Recording, ShareSettingsInput } from './types'
import type { RecorderStatus } from './types'
import { useScreenRecorder } from './hooks/useScreenRecorder'

function App() {
  const shareToken = getShareToken()

  if (shareToken) {
    return <ShareView token={shareToken} />
  }

  return <StudioApp />
}

function StudioApp() {
  const {
    canvasRef,
    status,
    micEnabled,
    cameraEnabled,
    elapsedMs,
    durationMs,
    recordingBlob,
    previewUrl,
    error,
    startRecording,
    stopRecording,
    resetRecording,
    toggleMic,
    toggleCamera,
  } = useScreenRecorder()
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [title, setTitle] = useState(() => `Recording ${new Date().toLocaleDateString()}`)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [sharePassword, setSharePassword] = useState('')
  const [passwordEnabled, setPasswordEnabled] = useState(false)
  const [shareExpiresAt, setShareExpiresAt] = useState('')
  const [shareDownloadEnabled, setShareDownloadEnabled] = useState(true)
  const [shareStatus, setShareStatus] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [libraryError, setLibraryError] = useState<string | null>(null)

  const selectedRecording = useMemo(
    () => recordings.find((recording) => recording.id === selectedId) ?? recordings[0] ?? null,
    [recordings, selectedId],
  )

  const applyShareDefaults = useCallback((recording: Recording | null) => {
    if (!recording) {
      setShareUrl(null)
      setSharePassword('')
      setPasswordEnabled(false)
      setShareExpiresAt('')
      setShareDownloadEnabled(true)
      setShareStatus(null)
      return
    }

    setShareUrl(recording.shareToken ? shareLink(recording.shareToken) : null)
    setSharePassword('')
    setPasswordEnabled(recording.sharePasswordProtected)
    setShareExpiresAt(toDatetimeLocal(recording.shareExpiresAt))
    setShareDownloadEnabled(recording.shareDownloadEnabled)
    setShareStatus(null)
  }, [])

  const loadLibrary = useCallback(async () => {
    try {
      const nextRecordings = await fetchRecordings()
      const nextSelectedId =
        selectedId && nextRecordings.some((recording) => recording.id === selectedId)
          ? selectedId
          : nextRecordings[0]?.id ?? null
      const nextSelectedRecording =
        nextRecordings.find((recording) => recording.id === nextSelectedId) ?? null

      setRecordings(nextRecordings)
      setLibraryError(null)
      setSelectedId(nextSelectedId)
      applyShareDefaults(nextSelectedRecording)
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : 'Could not load recordings')
    }
  }, [applyShareDefaults, selectedId])

  useEffect(() => {
    let isActive = true

    fetchRecordings()
      .then((nextRecordings) => {
        if (!isActive) {
          return
        }

        setRecordings(nextRecordings)
        setSelectedId(nextRecordings[0]?.id ?? null)
        applyShareDefaults(nextRecordings[0] ?? null)
        setLibraryError(null)
      })
      .catch((caughtError: unknown) => {
        if (!isActive) {
          return
        }

        setLibraryError(
          caughtError instanceof Error ? caughtError.message : 'Could not load recordings',
        )
      })

    return () => {
      isActive = false
    }
  }, [applyShareDefaults])

  const handleStart = useCallback(() => {
    void startRecording()
  }, [startRecording])

  const handleSave = useCallback(async () => {
    if (!recordingBlob) {
      return
    }

    setIsSaving(true)

    try {
      const saved = await uploadRecording({
        blob: recordingBlob,
        title,
        durationMs,
      })
      await loadLibrary()
      setSelectedId(saved.id)
      applyShareDefaults(saved)
      resetRecording()
      setShareUrl(null)
    } finally {
      setIsSaving(false)
    }
  }, [applyShareDefaults, durationMs, loadLibrary, recordingBlob, resetRecording, title])

  const handleShare = useCallback(
    async (recording: Recording) => {
      const settings = buildShareSettings({
        passwordEnabled,
        password: sharePassword,
        recording,
        expiresAt: shareExpiresAt,
        downloadEnabled: shareDownloadEnabled,
      })

      if (!settings) {
        setShareStatus('Add a password or turn password off.')
        return
      }

      const shared = await createShare(recording.id, settings)
      await loadLibrary()
      const nextUrl = shared.shareToken ? shareLink(shared.shareToken) : null
      applyShareDefaults(shared)
      setShareUrl(nextUrl)
      setSharePassword('')
      setShareStatus(shared.shareToken ? 'Share settings saved.' : null)

      if (nextUrl) {
        await copyText(nextUrl)
      }
    },
    [
      applyShareDefaults,
      loadLibrary,
      passwordEnabled,
      shareDownloadEnabled,
      shareExpiresAt,
      sharePassword,
    ],
  )

  const handleRevokeShare = useCallback(
    async (recording: Recording) => {
      const updated = await revokeShare(recording.id)
      await loadLibrary()
      applyShareDefaults(updated)
      setShareUrl(null)
      setShareStatus('Share link revoked.')
    },
    [applyShareDefaults, loadLibrary],
  )

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">
            <Video size={18} strokeWidth={2.4} />
          </span>
          <div>
            <h1>OpenCast</h1>
            <p>Private recorder</p>
          </div>
        </div>
        <div className="storage-chip" title="Recording storage root">
          <HardDrive size={16} />
          <span>D:\open-source\opencast-data</span>
        </div>
      </header>

      <section className="workspace">
        <section className="recorder-panel" aria-label="Recorder">
          <div className="panel-heading">
            <div>
              <h2>Recorder</h2>
              <p>{statusLabel(status)}</p>
            </div>
            <span className={`status-dot ${status}`} aria-hidden="true" />
          </div>

          <div className="stage">
            <canvas ref={canvasRef} className="recording-canvas" />
            {status === 'idle' && !previewUrl ? (
              <div className="stage-empty">
                <MonitorUp size={36} strokeWidth={1.6} />
                <span>Ready</span>
              </div>
            ) : null}
            {previewUrl ? (
              <video
                className="playback-preview"
                src={previewUrl}
                controls
                playsInline
              />
            ) : null}
          </div>

          <div className="control-strip" aria-label="Recording controls">
            <ToggleButton
              active={micEnabled}
              icon={<Mic size={18} />}
              label="Mic"
              onClick={toggleMic}
            />
            <ToggleButton
              active={cameraEnabled}
              icon={<Camera size={18} />}
              label="Camera"
              onClick={toggleCamera}
            />
            <div className="elapsed" title="Elapsed time">
              <Clock size={16} />
              <span>{formatTime(elapsedMs)}</span>
            </div>
            {status === 'recording' ? (
              <button className="danger-button" type="button" onClick={stopRecording}>
                <Square size={17} fill="currentColor" />
                Stop
              </button>
            ) : (
              <button
                className="primary-button"
                type="button"
                onClick={handleStart}
                disabled={status === 'requesting'}
              >
                <MonitorUp size={18} />
                Record
              </button>
            )}
          </div>

          <div className="save-row">
            <label htmlFor="recording-title">Title</label>
            <input
              id="recording-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Untitled recording"
            />
            <button
              className="secondary-button"
              type="button"
              onClick={handleSave}
              disabled={!recordingBlob || isSaving}
            >
              {isSaving ? <UploadCloud size={17} /> : <Save size={17} />}
              {isSaving ? 'Saving' : 'Save'}
            </button>
          </div>

          {error ? <p className="inline-error">{error}</p> : null}
        </section>

        <aside className="library-panel" aria-label="Recording library">
          <div className="panel-heading">
            <div>
              <h2>Library</h2>
              <p>{recordings.length} saved</p>
            </div>
            <button className="icon-button" type="button" onClick={loadLibrary} title="Refresh">
              <RefreshCcw size={17} />
            </button>
          </div>

          {libraryError ? <p className="inline-error">{libraryError}</p> : null}

          <div className="recording-list">
            {recordings.map((recording) => (
              <button
                className={`recording-row ${recording.id === selectedRecording?.id ? 'selected' : ''}`}
                key={recording.id}
                type="button"
                onClick={() => {
                  setSelectedId(recording.id)
                  applyShareDefaults(recording)
                }}
              >
                <span className="row-icon" aria-hidden="true">
                  <Play size={16} fill="currentColor" />
                </span>
                <span>
                  <strong>{recording.title}</strong>
                  <small>
                    {formatDate(recording.createdAt)} / {formatBytes(recording.sizeBytes)}
                  </small>
                </span>
              </button>
            ))}

            {!recordings.length ? (
              <div className="empty-library">
                <Pause size={22} />
                <span>No recordings yet</span>
              </div>
            ) : null}
          </div>

          {selectedRecording ? (
            <section className="viewer-panel" aria-label="Selected recording">
              <video
                key={selectedRecording.id}
                className="library-video"
                src={`/api/recordings/${selectedRecording.id}/video`}
                controls
                playsInline
              />
              <div className="viewer-meta">
                <div>
                  <strong>{selectedRecording.title}</strong>
                  <small>{formatTime(selectedRecording.durationMs ?? 0)}</small>
                </div>
                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={() => void handleShare(selectedRecording)}
                >
                  <Link2 size={16} />
                  {selectedRecording.shareToken ? 'Update' : 'Share'}
                </button>
              </div>
              <div className="share-controls" aria-label="Share settings">
                <label className="check-row">
                  <input
                    checked={passwordEnabled}
                    type="checkbox"
                    onChange={(event) => setPasswordEnabled(event.target.checked)}
                  />
                  <Lock size={16} />
                  Password
                </label>
                {passwordEnabled ? (
                  <input
                    aria-label="Share password"
                    className="share-input"
                    type="password"
                    value={sharePassword}
                    onChange={(event) => setSharePassword(event.target.value)}
                    placeholder={
                      selectedRecording.sharePasswordProtected ? 'Leave unchanged' : 'Set password'
                    }
                  />
                ) : null}

                <label className="field-row">
                  <span>Expires</span>
                  <input
                    className="share-input"
                    type="datetime-local"
                    value={shareExpiresAt}
                    onChange={(event) => setShareExpiresAt(event.target.value)}
                  />
                </label>

                <label className="check-row">
                  <input
                    checked={shareDownloadEnabled}
                    type="checkbox"
                    onChange={(event) => setShareDownloadEnabled(event.target.checked)}
                  />
                  <Download size={16} />
                  Downloads
                </label>

                <div className="share-actions">
                  <button
                    className="secondary-button compact"
                    type="button"
                    onClick={() => void handleShare(selectedRecording)}
                  >
                    <Link2 size={16} />
                    {selectedRecording.shareToken ? 'Save link' : 'Create link'}
                  </button>
                  {selectedRecording.shareToken ? (
                    <button
                      className="danger-outline-button compact"
                      type="button"
                      onClick={() => void handleRevokeShare(selectedRecording)}
                    >
                      <Trash2 size={16} />
                      Revoke
                    </button>
                  ) : null}
                </div>

                {selectedRecording.shareToken ? (
                  <p className="share-meta-line">
                    {selectedRecording.sharePasswordProtected ? 'Password protected' : 'Open link'} /
                    {selectedRecording.shareDownloadEnabled ? ' downloads on' : ' downloads off'} /
                    {selectedRecording.shareExpiresAt
                      ? ` expires ${formatDate(selectedRecording.shareExpiresAt)}`
                      : ' no expiry'}{' '}
                    / {selectedRecording.viewCount} views
                  </p>
                ) : null}
              </div>
              {shareUrl ? (
                <div className="share-box">
                  <Check size={16} />
                  <a href={shareUrl}>{shareUrl}</a>
                  <button
                    className="icon-button"
                    type="button"
                    title="Copy link"
                    onClick={() => void copyText(shareUrl)}
                  >
                    <Copy size={16} />
                  </button>
                </div>
              ) : null}
              {shareStatus ? <p className="share-status">{shareStatus}</p> : null}
            </section>
          ) : null}
        </aside>
      </section>
    </main>
  )
}

function ShareView({ token }: { token: string }) {
  const [recording, setRecording] = useState<Recording | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [requiresPassword, setRequiresPassword] = useState(false)
  const [isCheckingPassword, setIsCheckingPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchSharedRecording(token, accessToken ?? undefined)
      .then((response) => {
        setRecording(response.recording)
        setRequiresPassword(response.requiresPassword)
        setError(null)
      })
      .catch((caughtError: unknown) => {
        setError(caughtError instanceof Error ? caughtError.message : 'Share not found')
      })
  }, [accessToken, token])

  const handlePasswordSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      setIsCheckingPassword(true)

      try {
        const response = await requestShareAccess(token, password)
        setAccessToken(response.accessToken)
        setRecording(response.recording)
        setRequiresPassword(false)
        setError(null)
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : 'Could not unlock share')
      } finally {
        setIsCheckingPassword(false)
      }
    },
    [password, token],
  )

  const videoSource = recording
    ? `/api/shares/${token}/video${accessToken ? `?accessToken=${encodeURIComponent(accessToken)}` : ''}`
    : ''
  const downloadSource =
    recording && recording.shareDownloadEnabled
      ? `/api/shares/${token}/download${
          accessToken ? `?accessToken=${encodeURIComponent(accessToken)}` : ''
        }`
      : ''

  return (
    <main className="share-shell">
      <section className="share-player">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">
            <Video size={18} strokeWidth={2.4} />
          </span>
          <div>
            <h1>OpenCast</h1>
            <p>Shared recording</p>
          </div>
        </div>

        {recording ? (
          <>
            <video
              className="shared-video"
              src={videoSource}
              controls
              controlsList={recording.shareDownloadEnabled ? undefined : 'nodownload'}
              playsInline
              autoPlay={false}
            />
            <div className="shared-meta">
              <h2>{recording.title}</h2>
              <p>
                {formatDate(recording.createdAt)} / {formatTime(recording.durationMs ?? 0)}
              </p>
              {downloadSource ? (
                <a className="download-link" href={downloadSource}>
                  <Download size={16} />
                  Download
                </a>
              ) : null}
            </div>
          </>
        ) : requiresPassword ? (
          <form className="password-form" onSubmit={handlePasswordSubmit}>
            <Lock size={26} />
            <label htmlFor="share-password">Password</label>
            <input
              id="share-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button className="primary-button" type="submit" disabled={isCheckingPassword}>
              {isCheckingPassword ? 'Checking' : 'Unlock'}
            </button>
            {error ? <p className="inline-error">{error}</p> : null}
          </form>
        ) : (
          <div className="share-empty">
            <Link2 size={26} />
            <span>{error ?? 'Loading'}</span>
          </div>
        )}
      </section>
    </main>
  )
}

function ToggleButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={`toggle-button ${active ? 'active' : ''}`}
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={label}
    >
      {icon}
      {label}
    </button>
  )
}

function getShareToken() {
  const match = /^\/s\/([^/]+)$/.exec(window.location.pathname)
  return match?.[1] ?? null
}

function statusLabel(status: RecorderStatus) {
  const labels = {
    idle: 'Idle',
    requesting: 'Opening capture picker',
    recording: 'Recording',
    stopping: 'Finishing recording',
    ready: 'Ready to save',
    error: 'Needs attention',
  }

  return labels[status]
}

async function copyText(value: string) {
  if (!navigator.clipboard) {
    return
  }

  try {
    await navigator.clipboard.writeText(value)
  } catch {
    // Copy is a convenience; the visible link remains usable when permission is denied.
  }
}

function shareLink(token: string) {
  return `${window.location.origin}/s/${token}`
}

function buildShareSettings({
  passwordEnabled,
  password,
  recording,
  expiresAt,
  downloadEnabled,
}: {
  passwordEnabled: boolean
  password: string
  recording: Recording
  expiresAt: string
  downloadEnabled: boolean
}): ShareSettingsInput | null {
  const settings: ShareSettingsInput = {
    expiresAt: fromDatetimeLocal(expiresAt),
    downloadEnabled,
  }

  if (!passwordEnabled) {
    settings.password = null
    return settings
  }

  const trimmedPassword = password.trim()

  if (trimmedPassword) {
    settings.password = trimmedPassword
    return settings
  }

  if (recording.sharePasswordProtected) {
    return settings
  }

  return null
}

function toDatetimeLocal(value: string | null) {
  if (!value) {
    return ''
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return offsetDate.toISOString().slice(0, 16)
}

function fromDatetimeLocal(value: string) {
  if (!value) {
    return null
  }

  const timestamp = Date.parse(value)

  if (!Number.isFinite(timestamp)) {
    return null
  }

  return new Date(timestamp).toISOString()
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(value: number) {
  const totalSeconds = Math.floor(value / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export default App
