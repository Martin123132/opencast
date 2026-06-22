import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import {
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Eye,
  FilePenLine,
  HardDrive,
  Link2,
  ListChecks,
  Lock,
  Mic,
  MonitorUp,
  Pause,
  Play,
  Radio,
  RefreshCcw,
  Save,
  ShieldCheck,
  Square,
  Trash2,
  UploadCloud,
  Video,
  X,
} from 'lucide-react'
import './App.css'
import {
  createShare,
  deleteRecording,
  fetchAppConfig,
  fetchRecordings,
  fetchSharedRecording,
  requestShareAccess,
  revokeShare,
  updateRecording,
  uploadRecording,
} from './api'
import type { AppConfig, Recording, ShareSettingsInput } from './types'
import type { RecorderStatus } from './types'
import { useScreenRecorder } from './hooks/useScreenRecorder'

type StudioStep = 'setup' | 'record' | 'review' | 'share' | 'library'

type PendingDelete = {
  recording: Recording
  timerId: ReturnType<typeof setTimeout>
}

const setupStorageKey = 'opencast.setup.v1'
const undoDeleteWindowMs = 4000

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
    screenReady,
    countdown,
    elapsedMs,
    durationMs,
    recordingBlob,
    previewUrl,
    error,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    cancelRecording,
    resetRecording,
    toggleMic,
    toggleCamera,
  } = useScreenRecorder()
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [title, setTitle] = useState(() => `Recording ${new Date().toLocaleDateString()}`)
  const [selectedTitle, setSelectedTitle] = useState('')
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [sharePassword, setSharePassword] = useState('')
  const [passwordEnabled, setPasswordEnabled] = useState(false)
  const [shareExpiresAt, setShareExpiresAt] = useState('')
  const [shareDownloadEnabled, setShareDownloadEnabled] = useState(true)
  const [shareStatus, setShareStatus] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [setupComplete, setSetupComplete] = useState(() => {
    try {
      return window.localStorage.getItem(setupStorageKey) === 'complete'
    } catch {
      return false
    }
  })
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const recordButtonRef = useRef<HTMLButtonElement | null>(null)
  const saveButtonRef = useRef<HTMLButtonElement | null>(null)

  const captureSupported = Boolean(navigator.mediaDevices?.getDisplayMedia)
  const storageCompliant = appConfig?.dataRootCompliant !== false && !configError
  const selectedRecording = useMemo(
    () => recordings.find((recording) => recording.id === selectedId) ?? recordings[0] ?? null,
    [recordings, selectedId],
  )
  const activeStep = useMemo<StudioStep>(() => {
    if (!setupComplete) {
      return 'setup'
    }

    if (status === 'ready') {
      return 'review'
    }

    if (
      status === 'requesting' ||
      status === 'countdown' ||
      status === 'recording' ||
      status === 'paused' ||
      status === 'stopping'
    ) {
      return 'record'
    }

    if (shareDialogOpen) {
      return 'share'
    }

    if (selectedRecording) {
      return 'library'
    }

    return 'record'
  }, [selectedRecording, setupComplete, shareDialogOpen, status])
  const hasActiveCapture =
    status === 'requesting' || status === 'countdown' || status === 'recording' || status === 'paused'
  const hasReviewDraft = status === 'ready'
  const hasLibraryRecording = recordings.length > 0
  const hasSharedRecording = recordings.some((recording) => recording.shareToken)
  const firstRunPathReady = useMemo(
    () => ({
      setup: setupComplete,
      record: hasReviewDraft || hasActiveCapture || hasLibraryRecording,
      review: hasReviewDraft || hasLibraryRecording,
      share: hasSharedRecording,
      library: hasLibraryRecording,
    }),
    [hasActiveCapture, hasLibraryRecording, hasReviewDraft, hasSharedRecording, setupComplete],
  )
  const firstRunStep = hasReviewDraft
    ? 'Save'
    : hasLibraryRecording
      ? 'Share'
      : setupComplete
        ? 'Record'
        : 'Setup'
  const firstRunPrimaryAction = (() => {
    if (!setupComplete) {
      return 'Complete room setup'
    }

    if (hasReviewDraft) {
      return 'Save this draft'
    }

    return 'Record first take'
  })()
  const isFirstRunActionDisabled =
    setupComplete && !hasReviewDraft && status !== 'idle' && status !== 'error'
  const nextAction = getNextAction(activeStep, status, selectedRecording, hasReviewDraft)

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
      setSelectedTitle(nextSelectedRecording?.title ?? '')
      setDeleteTargetId(null)
      setPendingDelete(null)
      applyShareDefaults(nextSelectedRecording)
    } catch (caughtError) {
      setLibraryError(caughtError instanceof Error ? caughtError.message : 'Could not load recordings')
    }
  }, [applyShareDefaults, selectedId])

  useEffect(() => {
    let isActive = true

    fetchAppConfig()
      .then((nextConfig) => {
        if (!isActive) {
          return
        }

        setAppConfig(nextConfig)
        setConfigError(null)
      })
      .catch((caughtError: unknown) => {
        if (!isActive) {
          return
        }

        setConfigError(caughtError instanceof Error ? caughtError.message : 'Could not load config')
      })

    return () => {
      isActive = false
    }
  }, [])

  useEffect(() => {
    let isActive = true

    fetchRecordings()
      .then((nextRecordings) => {
        if (!isActive) {
          return
        }

        setRecordings(nextRecordings)
        setSelectedId(nextRecordings[0]?.id ?? null)
        setSelectedTitle(nextRecordings[0]?.title ?? '')
        setDeleteTargetId(null)
        setPendingDelete(null)
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

  const completeSetup = useCallback(() => {
    try {
      window.localStorage.setItem(setupStorageKey, 'complete')
    } catch {
      // The setup state is a convenience preference; the studio still works without storage.
    }

    setSetupComplete(true)
  }, [])

  const handleSelectRecording = useCallback(
    (recording: Recording) => {
      setSelectedId(recording.id)
      setSelectedTitle(recording.title)
      setDeleteTargetId(null)
      applyShareDefaults(recording)
      setShareDialogOpen(false)
    },
    [applyShareDefaults],
  )

  const handleStart = useCallback(() => {
    if (recordingBlob && !window.confirm('Discard the unsaved recording draft?')) {
      return
    }

    if (recordingBlob) {
      resetRecording()
    }

    void startRecording()
  }, [recordingBlob, resetRecording, startRecording])

  const handleFirstRunAction = useCallback(() => {
    if (!setupComplete) {
      completeSetup()
      return
    }

    if (isFirstRunActionDisabled) {
      return
    }

    if (hasReviewDraft) {
      saveButtonRef.current?.scrollIntoView({ block: 'center' })
      saveButtonRef.current?.focus()
      return
    }

    recordButtonRef.current?.scrollIntoView({ block: 'center' })
    recordButtonRef.current?.focus()
  }, [completeSetup, hasReviewDraft, isFirstRunActionDisabled, setupComplete])

  const handleCancel = useCallback(() => {
    if (!window.confirm('Stop and discard this capture?')) {
      return
    }

    cancelRecording()
  }, [cancelRecording])

  const handleDiscardDraft = useCallback(() => {
    if (!window.confirm('Discard this recording draft?')) {
      return
    }

    resetRecording()
  }, [resetRecording])

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
      setSelectedTitle(saved.title)
      applyShareDefaults(saved)
      resetRecording()
      setShareDialogOpen(true)
      setShareStatus('Saved. Share link ready when you are.')
      setTitle(`Recording ${new Date().toLocaleDateString()}`)
    } finally {
      setIsSaving(false)
    }
  }, [applyShareDefaults, durationMs, loadLibrary, recordingBlob, resetRecording, title])

  const handleRename = useCallback(async () => {
    const nextTitle = selectedTitle.trim()

    if (!selectedRecording || !nextTitle || nextTitle === selectedRecording.title) {
      return
    }

    setIsRenaming(true)

    try {
      const updated = await updateRecording(selectedRecording.id, nextTitle)
      await loadLibrary()
      setSelectedId(updated.id)
      setSelectedTitle(updated.title)
      applyShareDefaults(updated)
      setShareStatus('Recording renamed.')
    } finally {
      setIsRenaming(false)
    }
  }, [applyShareDefaults, loadLibrary, selectedRecording, selectedTitle])

  const handleRenameKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()

        if (!isRenaming && selectedRecording && selectedTitle.trim() !== selectedRecording.title) {
          void handleRename()
        }

        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        setSelectedTitle(selectedRecording?.title ?? '')
        setDeleteTargetId(null)
        event.currentTarget.blur()
      }
    },
    [handleRename, isRenaming, selectedRecording, selectedTitle],
  )

  const clearPendingDelete = useCallback(() => {
    setPendingDelete((nextDelete) => {
      if (nextDelete) {
        clearTimeout(nextDelete.timerId)
      }

      return null
    })
  }, [])

  const handleRequestDelete = useCallback(() => {
    if (!selectedRecording) {
      return
    }

    clearPendingDelete()
    setDeleteTargetId(selectedRecording.id)
  }, [clearPendingDelete, selectedRecording])

  const clearDeleteState = useCallback(() => {
    setDeleteTargetId(null)
    setIsDeleting(false)
  }, [])

  const finalizeDelete = useCallback(
    async (recordingId: string, timeoutRecording: Recording | null) => {
      setIsDeleting(true)

      try {
        await deleteRecording(recordingId)
        clearDeleteState()

        setPendingDelete((nextDelete) => {
          if (nextDelete?.recording.id === recordingId) {
            return null
          }

          return nextDelete
        })

        if (timeoutRecording) {
          setShareStatus(`"${timeoutRecording.title}" removed.`)
        } else {
          setShareStatus('Recording removed.')
        }

        await loadLibrary()
      } catch (caughtError) {
        setLibraryError(caughtError instanceof Error ? caughtError.message : 'Could not remove recording')
        await loadLibrary()
      } finally {
        setIsDeleting(false)
      }
    },
    [clearDeleteState, loadLibrary],
  )

  const handleDelete = useCallback(() => {
    if (!deleteTargetId || !selectedRecording) {
      return
    }

    const targetRecording = selectedRecording.id === deleteTargetId ? selectedRecording : null
    const target = targetRecording ?? recordings.find((recording) => recording.id === deleteTargetId)
    if (!target) {
      clearPendingDelete()
      setDeleteTargetId(null)
      return
    }

    clearPendingDelete()
    const timerId = setTimeout(() => {
      void finalizeDelete(target.id, target)
    }, undoDeleteWindowMs)

    setPendingDelete({ recording: target, timerId })
    setDeleteTargetId(null)
    if (selectedId === target.id) {
      setShareDialogOpen(false)
      setShareUrl(null)
    }

    setRecordings((nextRecordings) => {
      const withoutDeleted = nextRecordings.filter((recording) => recording.id !== target.id)
      const nextSelection =
        selectedId === target.id ? withoutDeleted[0] ?? null : nextRecordings.find((recording) => recording.id === selectedId)
      const nextSelectedRecording = nextSelection ?? withoutDeleted[0] ?? null

      setSelectedId(nextSelectedRecording?.id ?? null)
      setSelectedTitle(nextSelectedRecording?.title ?? '')
      applyShareDefaults(nextSelectedRecording)
      setShareUrl(null)

      return withoutDeleted
    })

    setShareStatus(`"${target.title}" deleted. Restore it with Undo.`)
  }, [
    deleteTargetId,
    clearPendingDelete,
    finalizeDelete,
    recordings,
    selectedId,
    applyShareDefaults,
    selectedRecording,
  ])

  const handleUndoDelete = useCallback(() => {
    if (!pendingDelete) {
      return
    }

    clearPendingDelete()
    const restored = pendingDelete.recording

    setRecordings((nextRecordings) => {
      if (nextRecordings.some((recording) => recording.id === restored.id)) {
        return nextRecordings
      }

      const restoredRecordings = [...nextRecordings, restored].toSorted((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      )

      setSelectedId(restored.id)
      setSelectedTitle(restored.title)
      applyShareDefaults(restored)

      return restoredRecordings
    })

    setShareStatus(`"${restored.title}" restored.`)
  }, [applyShareDefaults, clearPendingDelete, pendingDelete])

  useEffect(() => {
    if (!pendingDelete) {
      return
    }
    return () => {
      clearTimeout(pendingDelete.timerId)
    }
  }, [pendingDelete])

  const handleShare = useCallback(
    async (recording: Recording) => {
      const shouldUnexpire = recording.shareExpired && shareExpiresAt === toDatetimeLocal(recording.shareExpiresAt)
      const nextExpiresAt = shouldUnexpire ? '' : shareExpiresAt

      const settings = buildShareSettings({
        passwordEnabled,
        password: sharePassword,
        recording,
        expiresAt: nextExpiresAt,
        downloadEnabled: shareDownloadEnabled,
      })

      if (!settings) {
        setShareStatus('Add a password or turn password off.')
        return
      }

      const shared = await createShare(recording.id, settings)
      await loadLibrary()
      const nextUrl = shared.shareToken ? shareLink(shared.shareToken) : null
      const isUpdating = Boolean(recording.shareToken)
      applyShareDefaults(shared)
      setSelectedId(shared.id)
      setSelectedTitle(shared.title)
      setShareUrl(nextUrl)
      setSharePassword('')
      setShareDialogOpen(true)
      setShareStatus(isUpdating ? 'Share link updated.' : 'Share link created.')

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

  const setExpiryPreset = useCallback((preset: 'day' | 'week' | 'never') => {
    if (preset === 'never') {
      setShareExpiresAt('')
      return
    }

    const hours = preset === 'day' ? 24 : 24 * 7
    const date = new Date(Date.now() + hours * 60 * 60 * 1000)
    const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    setShareExpiresAt(offsetDate.toISOString().slice(0, 16))
  }, [])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">
            <Video size={18} strokeWidth={2.4} />
          </span>
          <div>
            <h1>ShareFrame</h1>
            <p>Guided recorder</p>
          </div>
        </div>
        <div className="topbar-actions">
          <StatusChip
            tone={captureSupported ? 'good' : 'bad'}
            icon={captureSupported ? <CheckCircle2 size={16} /> : <X size={16} />}
            label={captureSupported ? 'Capture ready' : 'Capture blocked'}
          />
          <div className="storage-chip" title="Recording storage root">
            <HardDrive size={16} />
            <span>{appConfig?.dataRoot ?? 'D:\\open-source\\opencast-data'}</span>
          </div>
        </div>
      </header>

      <section className="workspace">
        <MissionRail
          activeStep={activeStep}
          pathComplete={firstRunPathReady}
          appConfig={appConfig}
          captureSupported={captureSupported}
          nextAction={nextAction}
          setupComplete={setupComplete}
        />

        <section className="recorder-panel" aria-label="Recorder">
          {!setupComplete ? (
            <section className="setup-card" aria-label="Setup">
              <div>
                <h2>Ready Room</h2>
                <p>{configError ?? 'D-drive storage, browser capture, private sharing.'}</p>
              </div>
              <button
                className="primary-button"
                type="button"
                onClick={completeSetup}
                disabled={!captureSupported || !storageCompliant}
              >
                <Check size={18} />
                Start
              </button>
            </section>
          ) : null}

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
                <span>Choose a screen or window</span>
              </div>
            ) : null}
            {status === 'countdown' ? (
              <div className="countdown-overlay" aria-live="polite">
                <strong>{countdown}</strong>
                <span>Recording starts</span>
              </div>
            ) : null}
            {status === 'paused' ? (
              <div className="pause-overlay" aria-live="polite">
                <Pause size={24} />
                <span>Paused</span>
              </div>
            ) : null}
            {previewUrl ? (
              <video className="playback-preview" src={previewUrl} controls playsInline />
            ) : null}
          </div>

          <div className="control-strip" aria-label="Recording controls">
            <ToggleButton
              active={micEnabled}
              disabled={isCaptureActive(status)}
              icon={<Mic size={18} />}
              label="Mic"
              onClick={toggleMic}
            />
            <ToggleButton
              active={cameraEnabled}
              disabled={isCaptureActive(status)}
              icon={<Camera size={18} />}
              label="Camera"
              onClick={toggleCamera}
            />
            <div className={`source-pill ${screenReady ? 'ready' : ''}`}>
              <Radio size={16} />
              <span>{screenReady ? 'Source armed' : 'No source'}</span>
            </div>
            <div className="elapsed" title="Elapsed time">
              <Clock size={16} />
              <span>{formatTime(elapsedMs)}</span>
            </div>

            {status === 'recording' ? (
              <>
                <button className="secondary-button" type="button" onClick={pauseRecording}>
                  <Pause size={17} />
                  Pause
                </button>
                <button className="danger-button" type="button" onClick={stopRecording}>
                  <Square size={17} fill="currentColor" />
                  Stop
                </button>
                <button className="danger-outline-button" type="button" onClick={handleCancel}>
                  <Trash2 size={16} />
                  Cancel
                </button>
              </>
            ) : null}

            {status === 'paused' ? (
              <>
                <button className="primary-button" type="button" onClick={resumeRecording}>
                  <Play size={17} fill="currentColor" />
                  Resume
                </button>
                <button className="danger-button" type="button" onClick={stopRecording}>
                  <Square size={17} fill="currentColor" />
                  Stop
                </button>
                <button className="danger-outline-button" type="button" onClick={handleCancel}>
                  <Trash2 size={16} />
                  Cancel
                </button>
              </>
            ) : null}

            {status === 'requesting' || status === 'countdown' || status === 'stopping' ? (
              <button className="danger-outline-button" type="button" onClick={handleCancel}>
                <X size={16} />
                Cancel
              </button>
            ) : null}

            {status === 'idle' || status === 'ready' || status === 'error' ? (
              <button
                className="primary-button"
                type="button"
                ref={recordButtonRef}
                onClick={handleStart}
                disabled={!captureSupported}
              >
                <MonitorUp size={18} />
                Record
              </button>
            ) : null}
          </div>

            {status === 'ready' ? (
            <section className="review-card" aria-label="Review recording">
              <div className="review-heading">
                <span className="row-icon" aria-hidden="true">
                  <FilePenLine size={17} />
                </span>
                <div>
                  <h3>Review</h3>
                  <p>{formatTime(durationMs ?? 0)} draft</p>
                </div>
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
                  ref={saveButtonRef}
                  disabled={!recordingBlob || isSaving}
                >
                  {isSaving ? <UploadCloud size={17} /> : <Save size={17} />}
                  {isSaving ? 'Saving' : 'Save'}
                </button>
              </div>
              <div className="review-actions">
                {previewUrl ? (
                  <a className="secondary-link" href={previewUrl} download={`${normalizeFileName(title)}.webm`}>
                    <Download size={16} />
                    Download draft
                  </a>
                ) : null}
                <button className="danger-outline-button compact" type="button" onClick={handleDiscardDraft}>
                  <Trash2 size={16} />
                  Discard
                </button>
              </div>
            </section>
          ) : null}

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

          {pendingDelete ? (
            <div className="undo-banner" aria-live="polite">
              <span>{`"${pendingDelete.recording.title}" deleted.`}</span>
              <button
                className="secondary-button compact"
                type="button"
                onClick={handleUndoDelete}
                disabled={isDeleting}
              >
                Undo
              </button>
              <span>{`Remove finalizes in ${Math.round(undoDeleteWindowMs / 1000)} seconds.`}</span>
            </div>
          ) : null}

          <div className="recording-list">
            {recordings.map((recording) => (
              <button
                className={`recording-row ${recording.id === selectedRecording?.id ? 'selected' : ''}`}
                key={recording.id}
                type="button"
                onClick={() => handleSelectRecording(recording)}
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
                <span className={`row-status ${recording.shareToken ? 'shared' : ''}`}>
                  {recording.shareToken ? 'Shared' : 'Private'}
                </span>
              </button>
            ))}

            {!recordings.length ? (
              <div className="empty-library">
                <ListChecks size={22} />
                <span>No recordings yet</span>
                <p>Your path: Setup, Record, Save, Share.</p>
                <ol className="first-run-steps">
                  <li className={firstRunPathReady.setup ? 'complete' : ''}>
                    <span>{firstRunPathReady.setup ? <Check size={14} /> : <span>1</span>}</span>
                    Set up room
                  </li>
                  <li className={firstRunPathReady.record ? 'complete' : ''}>
                    <span>{firstRunPathReady.record ? <Check size={14} /> : <span>2</span>}</span>
                    Record first take
                  </li>
                  <li className={firstRunPathReady.review ? 'complete' : ''}>
                    <span>{firstRunPathReady.review ? <Check size={14} /> : <span>3</span>}</span>
                    Save to library
                  </li>
                  <li className={firstRunPathReady.share ? 'complete' : ''}>
                    <span>{firstRunPathReady.share ? <Check size={14} /> : <span>4</span>}</span>
                    Share
                  </li>
                </ol>
                <button
                  className="primary-button compact"
                  type="button"
                  onClick={handleFirstRunAction}
                  disabled={isFirstRunActionDisabled}
                  aria-label={`First run action: ${firstRunPrimaryAction}`}
                >
                  {firstRunPrimaryAction}
                </button>
                <small>{`Next: ${firstRunStep}`}</small>
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
                <StatusChip
                  tone={selectedRecording.shareToken ? 'good' : 'neutral'}
                  icon={selectedRecording.shareToken ? <Link2 size={15} /> : <Lock size={15} />}
                  label={selectedRecording.shareToken ? 'Shared' : 'Private'}
                />
              </div>
              <div className="rename-row">
                <input
                  aria-label="Recording title"
                  value={selectedTitle}
                  onChange={(event) => setSelectedTitle(event.target.value)}
                  onKeyDown={handleRenameKeyDown}
                />
                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={handleRename}
                  disabled={isRenaming || selectedTitle.trim() === selectedRecording?.title || !selectedTitle.trim()}
                >
                  <Save size={16} />
                  Rename
                </button>
              </div>
              <div className="viewer-actions">
                <button
                  className="primary-button compact"
                  type="button"
                  onClick={() => {
                    applyShareDefaults(selectedRecording)
                    setShareDialogOpen(true)
                  }}
                >
                  <Link2 size={16} />
                  Share
                </button>
                {selectedRecording.shareToken ? (
                  <button
                    className="secondary-button compact"
                    type="button"
                    onClick={() => void handleRevokeShare(selectedRecording)}
                  >
                    <Lock size={16} />
                    Unshare
                  </button>
                ) : null}
                <a
                  className="secondary-link compact"
                  href={`/api/recordings/${selectedRecording.id}/video`}
                  download
                >
                  <Download size={16} />
                  Download
                </a>
                {deleteTargetId === selectedRecording.id ? (
                  <>
                    <span className="delete-warning">Delete this recording permanently?</span>
                    <button
                      className="secondary-button compact"
                      type="button"
                      onClick={() => setDeleteTargetId(null)}
                      disabled={isDeleting}
                    >
                      Keep
                    </button>
                    <button
                      className="danger-outline-button compact"
                      type="button"
                      onClick={handleDelete}
                      disabled={isDeleting}
                    >
                      <Trash2 size={16} />
                      {isDeleting ? 'Removing' : 'Confirm delete'}
                    </button>
                  </>
                ) : (
                  <button
                    className="danger-outline-button compact"
                    type="button"
                    onClick={handleRequestDelete}
                    disabled={isDeleting}
                  >
                    <Trash2 size={16} />
                    Delete
                  </button>
                )}
              </div>
              {shareStatus ? <p className="share-status">{shareStatus}</p> : null}
            </section>
          ) : null}
        </aside>
      </section>

      {shareDialogOpen && selectedRecording ? (
        <ShareDialog
          recording={selectedRecording}
          shareUrl={shareUrl}
          passwordEnabled={passwordEnabled}
          password={sharePassword}
          expiresAt={shareExpiresAt}
          downloadEnabled={shareDownloadEnabled}
          status={shareStatus}
          onClose={() => setShareDialogOpen(false)}
          onCopy={() => {
            if (shareUrl) {
              void copyText(shareUrl)
              setShareStatus('Share link copied.')
            }
          }}
          onPasswordEnabledChange={setPasswordEnabled}
          onPasswordChange={setSharePassword}
          onExpiresAtChange={setShareExpiresAt}
          onDownloadEnabledChange={setShareDownloadEnabled}
          onExpiryPreset={setExpiryPreset}
          onSave={() => void handleShare(selectedRecording)}
          onRevoke={() => void handleRevokeShare(selectedRecording)}
        />
      ) : null}
    </main>
  )
}

function MissionRail({
  activeStep,
  pathComplete,
  appConfig,
  captureSupported,
  nextAction,
  setupComplete,
}: {
  activeStep: StudioStep
  pathComplete: {
    setup: boolean
    record: boolean
    review: boolean
    share: boolean
    library: boolean
  }
  appConfig: AppConfig | null
  captureSupported: boolean
  nextAction: string
  setupComplete: boolean
}) {
  const isReviewDraft = activeStep === 'review'
  const stepGuidance = getStepGuidance(activeStep, isReviewDraft)
  const steps: Array<{ id: StudioStep; label: string; icon: ReactNode; complete: boolean }> = [
    {
      id: 'setup',
      label: 'Setup',
      icon: <ShieldCheck size={17} />,
      complete: setupComplete,
    },
    {
      id: 'record',
      label: 'Record',
      icon: <MonitorUp size={17} />,
      complete: pathComplete.record,
    },
    {
      id: 'review',
      label: 'Review',
      icon: <FilePenLine size={17} />,
      complete: pathComplete.review,
    },
    {
      id: 'share',
      label: 'Share',
      icon: <Link2 size={17} />,
      complete: pathComplete.share,
    },
    {
      id: 'library',
      label: 'Library',
      icon: <ListChecks size={17} />,
      complete: pathComplete.library,
    },
  ]

  return (
    <aside className="mission-rail" aria-label="Workflow">
      <div className="mission-heading">
        <span className="mission-mark" aria-hidden="true">
          <Radio size={17} />
        </span>
        <div>
          <h2>Path</h2>
          <p>{nextAction}</p>
        </div>
      </div>
      <ol className="step-list">
        {steps.map((step) => (
          <li className={step.id === activeStep ? 'active' : step.complete ? 'complete' : ''} key={step.id}>
            <span aria-hidden="true">{step.complete ? <Check size={17} /> : step.icon}</span>
            <strong>{step.label}</strong>
          </li>
        ))}
      </ol>
      <section className="guide-card" aria-label="Current guidance">
        <span>{stepGuidance.kicker}</span>
        <strong>{stepGuidance.title}</strong>
        <p>{stepGuidance.body}</p>
      </section>
      <div className="readiness-card">
        <StatusChip
          tone={captureSupported ? 'good' : 'bad'}
          icon={captureSupported ? <CheckCircle2 size={15} /> : <X size={15} />}
          label={captureSupported ? 'Browser OK' : 'Browser blocked'}
        />
        <StatusChip
          tone={appConfig?.dataRootCompliant === false ? 'bad' : 'good'}
          icon={<HardDrive size={15} />}
          label={appConfig?.requiredStorageDrive ?? 'D:'}
        />
      </div>
    </aside>
  )
}

function ShareDialog({
  recording,
  shareUrl,
  passwordEnabled,
  password,
  expiresAt,
  downloadEnabled,
  status,
  onClose,
  onCopy,
  onPasswordEnabledChange,
  onPasswordChange,
  onExpiresAtChange,
  onDownloadEnabledChange,
  onExpiryPreset,
  onSave,
  onRevoke,
}: {
  recording: Recording
  shareUrl: string | null
  passwordEnabled: boolean
  password: string
  expiresAt: string
  downloadEnabled: boolean
  status: string | null
  onClose: () => void
  onCopy: () => void
  onPasswordEnabledChange: (value: boolean) => void
  onPasswordChange: (value: string) => void
  onExpiresAtChange: (value: string) => void
  onDownloadEnabledChange: (value: boolean) => void
  onExpiryPreset: (value: 'day' | 'week' | 'never') => void
  onSave: () => void
  onRevoke: () => void
}) {
  const hasActiveShare = Boolean(recording.shareToken && !recording.shareExpired)
  const hasAnyShareLink = Boolean(recording.shareToken || shareUrl)
  const linkActionLabel = recording.shareExpired ? 'Recreate link' : hasAnyShareLink ? 'Update link' : 'Create link'
  const canShareActions = hasActiveShare
  const shareLinkLabel = recording.shareExpired
    ? 'Share link expired'
    : hasActiveShare
      ? 'Share link active'
      : 'No shared link yet'
  const shareLinkTone: 'good' | 'bad' | 'neutral' = recording.shareExpired
    ? 'bad'
    : hasAnyShareLink
      ? 'good'
      : 'neutral'
  const safeStateHint = (() => {
    if (recording.shareExpired) {
      return 'This share link expired. Recreate it to generate a fresh public URL.'
    }

    if (hasActiveShare) {
      return 'Public link is ready. Copy to share or revoke when needed.'
    }

    return 'No active public link. Create one from this recording.'
  })()

  const shouldShowShareLink = hasActiveShare

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="share-dialog" role="dialog" aria-modal="true" aria-label="Share recording">
        <div className="dialog-heading">
          <div>
            <h2>Share</h2>
            <p>{recording.title}</p>
          </div>
          <button
            aria-label="Close share dialog"
            className="icon-button"
            type="button"
            onClick={onClose}
            title="Close"
          >
            <X size={17} />
          </button>
        </div>

        <div className="share-state">
          <StatusChip
            tone={shareLinkTone}
            icon={recording.shareToken ? <Link2 size={15} /> : <Lock size={15} />}
            label={shareLinkLabel}
          />
          <StatusChip
            tone={recording.sharePasswordProtected ? 'good' : 'neutral'}
            icon={recording.sharePasswordProtected ? <ShieldCheck size={15} /> : <Lock size={15} />}
            label={recording.sharePasswordProtected ? 'Password' : 'No password'}
          />
          <StatusChip
            tone={recording.shareExpired ? 'bad' : 'neutral'}
            icon={<Clock size={15} />}
            label={recording.shareExpired ? 'Expired' : `${recording.viewCount} views`}
          />
        </div>

        <div className="share-controls" aria-label="Share settings">
          <label className="check-row">
            <input
              checked={passwordEnabled}
              type="checkbox"
              onChange={(event) => onPasswordEnabledChange(event.target.checked)}
            />
            <Lock size={16} />
            Password
          </label>
          {passwordEnabled ? (
            <input
              aria-label="Share password"
              className="share-input"
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder={recording.sharePasswordProtected ? 'Leave unchanged' : 'Set password'}
            />
          ) : null}

          <div className="preset-row" aria-label="Expiry presets">
            <button className="secondary-button compact" type="button" onClick={() => onExpiryPreset('day')}>
              24h
            </button>
            <button className="secondary-button compact" type="button" onClick={() => onExpiryPreset('week')}>
              7d
            </button>
            <button className="secondary-button compact" type="button" onClick={() => onExpiryPreset('never')}>
              Never
            </button>
          </div>

          <label className="field-row">
            <span>Expires</span>
            <input
              className="share-input"
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => onExpiresAtChange(event.target.value)}
            />
          </label>

          <label className="check-row">
            <input
              checked={downloadEnabled}
              type="checkbox"
              onChange={(event) => onDownloadEnabledChange(event.target.checked)}
            />
            <Download size={16} />
            Downloads
          </label>
        </div>

        {shouldShowShareLink && shareUrl ? (
          <div className="share-box">
            <strong className="share-link-label">Guest link</strong>
            <div className="share-link-row">
              <a className="share-link" href={shareUrl}>
                {shareUrl}
              </a>
              <button className="secondary-button compact" type="button" title="Copy link" onClick={onCopy}>
                <Copy size={16} />
                Copy link
              </button>
            </div>
          </div>
        ) : null}

        <div className="dialog-actions">
          <button className="primary-button" type="button" onClick={onSave}>
            <Link2 size={16} />
            {linkActionLabel}
          </button>
          {canShareActions ? (
            <a className="secondary-link" href={shareUrl ?? ''} target="_blank" rel="noreferrer">
              <Eye size={16} />
              View as guest
            </a>
          ) : null}
          {recording.shareToken ? (
            <button className="danger-outline-button" type="button" onClick={onRevoke}>
              <Trash2 size={16} />
              Revoke
            </button>
          ) : null}
        </div>

        <p className="share-status">{safeStateHint}</p>
        {status ? <p className="share-status">{status}</p> : null}
      </section>
    </div>
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
        setError(normalizeShareAccessError(caughtError))
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
        setError(normalizeShareAccessError(caughtError, 'Could not unlock share'))
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
            <h1>ShareFrame</h1>
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

function normalizeShareAccessError(caughtError: unknown, fallback = 'This share link is unavailable.') {
  const message = caughtError instanceof Error ? caughtError.message : fallback
  const lowered = message.toLowerCase()

  if (lowered.includes('share not found') || lowered.includes('share link is unavailable')) {
    return 'This share link is unavailable.'
  }

  if (lowered.includes('share link expired')) {
    return 'This share link is no longer available.'
  }

  if (lowered.includes('request failed with 404') || lowered.includes('request failed with 410')) {
    return 'This share link is unavailable.'
  }

  return message
}

function ToggleButton({
  active,
  disabled,
  icon,
  label,
  onClick,
}: {
  active: boolean
  disabled?: boolean
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={`toggle-button ${active ? 'active' : ''}`}
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      title={label}
    >
      {icon}
      {label}
    </button>
  )
}

function StatusChip({
  icon,
  label,
  tone,
}: {
  icon: ReactNode
  label: string
  tone: 'good' | 'bad' | 'neutral'
}) {
  return (
    <span className={`status-chip ${tone}`}>
      {icon}
      {label}
    </span>
  )
}

function getShareToken() {
  const match = /^\/s\/([^/]+)$/.exec(window.location.pathname)
  return match?.[1] ?? null
}

function statusLabel(status: RecorderStatus) {
  const labels = {
    idle: 'Ready',
    requesting: 'Opening capture picker',
    countdown: 'Countdown',
    recording: 'Recording',
    paused: 'Paused',
    stopping: 'Finishing recording',
    ready: 'Ready to review',
    error: 'Needs attention',
  }

  return labels[status]
}

function isCaptureActive(status: RecorderStatus) {
  return status === 'requesting' || status === 'countdown' || status === 'recording' || status === 'paused'
}

function getNextAction(
  activeStep: StudioStep,
  status: RecorderStatus,
  selectedRecording: Recording | null,
  hasReviewDraft: boolean,
) {
  if (activeStep === 'setup') {
    return 'Confirm launch'
  }

  if (activeStep === 'review') {
    if (hasReviewDraft && status === 'ready') {
      return 'Save this draft'
    }

    return 'Save or discard'
  }

  if (activeStep === 'share') {
    return 'Lock the link'
  }

  if (status === 'recording') {
    return 'Capture running'
  }

  if (selectedRecording) {
    return 'Manage library'
  }

  return 'Start recording'
}

function getStepGuidance(activeStep: StudioStep, hasReviewDraft: boolean) {
  const guidance: Record<StudioStep, { kicker: string; title: string; body: string }> = {
    setup: {
      kicker: 'Step 1',
      title: 'Confirm the room',
      body: 'Check browser capture and D-drive storage before opening the recorder.',
    },
    record: {
      kicker: 'Step 2',
      title: 'Choose what to capture',
      body: 'Pick a screen or window, then use the focused controls to record only what matters.',
    },
    review: {
      kicker: 'Step 3',
      title: hasReviewDraft ? 'Save this draft' : 'Name the take',
      body: hasReviewDraft
        ? 'Give it a title and save it to lock the clip in your library.'
        : 'Preview the draft, give it a clear title, and save it into the local library.',
    },
    share: {
      kicker: 'Step 4',
      title: 'Lock the link',
      body: 'Create a private guest link, then choose password, expiry, and download access.',
    },
    library: {
      kicker: 'Step 5',
      title: 'Manage the archive',
      body: 'Rename, download, delete, or reopen sharing for anything stored locally.',
    },
  }

  return guidance[activeStep]
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

function normalizeFileName(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'recording'
  )
}

export default App

