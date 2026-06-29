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
  AlertTriangle,
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
  RotateCcw,
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
  createLibraryBackup,
  createShare,
  deleteRecording,
  fetchAppConfig,
  fetchLibraryBackupPreview,
  fetchLibraryBackups,
  fetchRecordings,
  fetchSharedRecording,
  requestShareAccess,
  revokeShare,
  restoreLibraryBackup,
  updateRecording,
  uploadRecording,
} from './api'
import type {
  AppConfig,
  LibraryBackup,
  LibraryBackupPreview,
  LibraryBackupRestore,
  Recording,
  RecordingDurationSource,
  ShareSettingsInput,
} from './types'
import type { RecorderStatus } from './types'
import { useScreenRecorder } from './hooks/useScreenRecorder'

type StudioStep = 'setup' | 'record' | 'review' | 'share' | 'library'
type LibrarySort = 'newest' | 'title' | 'share'
type RecordingShareState = 'shared' | 'expired' | 'revoked' | 'private'

type PendingDelete = {
  recording: Recording
  timerId: ReturnType<typeof setTimeout>
}

type PreflightItem = {
  label: string
  value: string
  icon: ReactNode
  tone: 'good' | 'warning' | 'bad' | 'neutral'
}

const setupStorageKey = 'opencast.setup.v1'
const undoDeleteWindowMs = 4000
const fallbackRecordingGuardrails = {
  maxRecordingBytes: 2 * 1024 * 1024 * 1024,
  maxUploadOverheadBytes: 16 * 1024 * 1024,
  storageWarningThresholdBytes: 5 * 1024 * 1024 * 1024,
  longRecordingWarningMs: 60 * 60 * 1000,
}
const copyBlockedStatus =
  'Copy blocked. Select the guest link, or use Preview guest view and copy the address from the browser.'

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
    durationSource,
    recordingBlob,
    thumbnailBlob,
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
    setMicEnabled,
    setCameraEnabled,
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
  const [captureDiscardArmed, setCaptureDiscardArmed] = useState(false)
  const [draftRestartArmed, setDraftRestartArmed] = useState(false)
  const [draftDiscardArmed, setDraftDiscardArmed] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [librarySort, setLibrarySort] = useState<LibrarySort>('newest')
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null)
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [isBackingUp, setIsBackingUp] = useState(false)
  const [backupStatus, setBackupStatus] = useState<string | null>(null)
  const [backups, setBackups] = useState<LibraryBackup[]>([])
  const [backupPreview, setBackupPreview] = useState<LibraryBackupPreview | null>(null)
  const [isPreviewingBackup, setIsPreviewingBackup] = useState(false)
  const [isRestoringBackup, setIsRestoringBackup] = useState(false)
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

  const copyShareLink = useCallback(async (url: string, successMessage = 'Share link copied.') => {
    const copied = await copyText(url)
    setShareStatus(copied ? successMessage : copyBlockedStatus)
    return copied
  }, [])

  const captureSupported = Boolean(navigator.mediaDevices?.getDisplayMedia)
  const storageCompliant = appConfig?.dataRootCompliant !== false && !configError
  const selectedRecording = useMemo(
    () => recordings.find((recording) => recording.id === selectedId) ?? recordings[0] ?? null,
    [recordings, selectedId],
  )
  const visibleRecordings = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase()
    const filteredRecordings = query
      ? recordings.filter((recording) =>
          [recording.title, formatDate(recording.createdAt), getRecordingShareState(recording)]
            .join(' ')
            .toLowerCase()
            .includes(query),
        )
      : recordings

    return [...filteredRecordings].sort((left, right) => compareLibraryRecordings(left, right, librarySort))
  }, [libraryQuery, librarySort, recordings])
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
  const recordingGuardrails = appConfig?.recordingGuardrails ?? fallbackRecordingGuardrails
  const draftSizeStatus = recordingBlob
    ? getDraftSizeStatus(recordingBlob.size, recordingGuardrails.maxRecordingBytes)
    : 'ready'
  const isDraftTooLarge = draftSizeStatus === 'too-large'
  const isLongDraft = Boolean(
    durationMs !== null && durationMs >= recordingGuardrails.longRecordingWarningMs,
  )
  const captureDiscardPending = captureDiscardArmed && hasActiveCapture
  const draftRestartPending = draftRestartArmed && status === 'ready' && recordingBlob !== null
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
  const recorderHint = getRecorderHint(
    status,
    screenReady,
    micEnabled,
    cameraEnabled,
    countdown,
  )
  const recorderNextHint = draftRestartPending
    ? 'Choose Keep draft to save or review this take, or discard it to record again.'
    : captureDiscardPending
      ? 'Choose Keep recording to continue, or Discard take to stop without saving.'
      : getRecorderNextHint(status)
  const recorderActionCues = getRecorderActionCues(status, captureDiscardPending, draftRestartPending)
  const recorderPhaseSteps = getRecorderPhaseSteps(status)
  const recorderPreflight = getRecorderPreflightItems({
    captureSupported,
    storageCompliant,
    screenReady,
    micEnabled,
    cameraEnabled,
    status,
    recordingGuardrails,
    diskStatus: appConfig?.storageHealth.disk.status ?? 'unknown',
  })
  const selectedShareState = selectedRecording ? getRecordingShareState(selectedRecording) : 'private'
  const selectedActiveShareUrl = selectedRecording && selectedShareState === 'shared' ? shareUrl : null
  const selectedShareHint = selectedRecording ? getRecordingShareOwnerHint(selectedRecording) : null
  const selectedOwnerPathAction = selectedRecording
    ? getRecordingOwnerPathAction(selectedRecording, selectedActiveShareUrl)
    : null
  const canClearCaptureState =
    (status === 'idle' || status === 'error' || status === 'ready') && (micEnabled || cameraEnabled)

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

  const handleCreateBackup = useCallback(async () => {
    setIsBackingUp(true)
    setBackupStatus(null)

    try {
      const backup = await createLibraryBackup()
      const nextConfig = await fetchAppConfig()
      const nextBackups = await fetchLibraryBackups()
      setAppConfig(nextConfig)
      setBackups(nextBackups)
      setBackupPreview(null)
      setConfigError(null)
      setBackupStatus(formatBackupStatus(backup))
    } catch (caughtError) {
      setBackupStatus(caughtError instanceof Error ? caughtError.message : 'Backup could not be created.')
    } finally {
      setIsBackingUp(false)
    }
  }, [])

  const handlePreviewBackup = useCallback(async (backup: LibraryBackup) => {
    setIsPreviewingBackup(true)
    setBackupStatus(null)

    try {
      const preview = await fetchLibraryBackupPreview(backup.id)
      setBackupPreview(preview)
    } catch (caughtError) {
      setBackupPreview(null)
      setBackupStatus(caughtError instanceof Error ? caughtError.message : 'Backup preview could not be loaded.')
    } finally {
      setIsPreviewingBackup(false)
    }
  }, [])

  const handleRestoreBackup = useCallback(async (backup: LibraryBackupPreview) => {
    setIsRestoringBackup(true)
    setBackupStatus(null)

    try {
      const restore = await restoreLibraryBackup(backup.id)
      const nextRecordings = await fetchRecordings()
      const nextConfig = await fetchAppConfig()
      const nextBackups = await fetchLibraryBackups()
      const selectedRestoredRecording = restore.importedRecordings[0] ?? null
      const nextSelectedRecording = selectedRestoredRecording
        ? nextRecordings.find((recording) => recording.id === selectedRestoredRecording.id) ?? selectedRestoredRecording
        : selectedRecording
          ? nextRecordings.find((recording) => recording.id === selectedRecording.id) ?? nextRecordings[0] ?? null
          : nextRecordings[0] ?? null

      setRecordings(nextRecordings)
      setAppConfig(nextConfig)
      setBackups(nextBackups)
      setBackupPreview(restore.backup)
      setSelectedId(nextSelectedRecording?.id ?? null)
      setSelectedTitle(nextSelectedRecording?.title ?? '')
      applyShareDefaults(nextSelectedRecording)
      setLibraryError(null)
      setConfigError(null)
      setBackupStatus(formatBackupRestoreStatus(restore))
    } catch (caughtError) {
      setBackupStatus(caughtError instanceof Error ? caughtError.message : 'Backup restore could not be completed.')
    } finally {
      setIsRestoringBackup(false)
    }
  }, [applyShareDefaults, selectedRecording])

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
    setCaptureDiscardArmed(false)

    if (recordingBlob) {
      setDraftDiscardArmed(false)
      setDraftRestartArmed(true)
      return
    }

    setDraftRestartArmed(false)
    void startRecording()
  }, [recordingBlob, startRecording])

  const handleClearCaptureState = useCallback(() => {
    setMicEnabled(false)
    setCameraEnabled(false)
  }, [setMicEnabled, setCameraEnabled])

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

  const handlePauseRecording = useCallback(() => {
    setCaptureDiscardArmed(false)
    pauseRecording()
  }, [pauseRecording])

  const handleResumeRecording = useCallback(() => {
    setCaptureDiscardArmed(false)
    resumeRecording()
  }, [resumeRecording])

  const handleStopRecording = useCallback(() => {
    setCaptureDiscardArmed(false)
    stopRecording()
  }, [stopRecording])

  const handleArmCaptureDiscard = useCallback(() => {
    setCaptureDiscardArmed(true)
  }, [])

  useEffect(() => {
    let isActive = true

    fetchLibraryBackups()
      .then((nextBackups) => {
        if (!isActive) {
          return
        }

        setBackups(nextBackups)
      })
      .catch(() => {
        if (!isActive) {
          return
        }

        setBackups([])
      })

    return () => {
      isActive = false
    }
  }, [])

  const handleKeepCapture = useCallback(() => {
    setCaptureDiscardArmed(false)
  }, [])

  const handleConfirmCaptureDiscard = useCallback(() => {
    setCaptureDiscardArmed(false)
    cancelRecording()
  }, [cancelRecording])

  const handleKeepDraftForRestart = useCallback(() => {
    setDraftRestartArmed(false)
  }, [])

  const handleConfirmDraftRestart = useCallback(() => {
    setDraftRestartArmed(false)
    setDraftDiscardArmed(false)
    resetRecording()
    void startRecording()
  }, [resetRecording, startRecording])

  const handleDiscardDraft = useCallback(() => {
    if (!draftDiscardArmed) {
      setDraftRestartArmed(false)
      setDraftDiscardArmed(true)
      return
    }

    setDraftRestartArmed(false)
    setDraftDiscardArmed(false)
    resetRecording()
  }, [draftDiscardArmed, resetRecording])

  const handleSave = useCallback(async () => {
    if (!recordingBlob) {
      return
    }

    setDraftSaveError(null)

    if (isDraftTooLarge) {
      setDraftSaveError(
        `Draft is ${formatBytes(recordingBlob.size)}. Single recordings must stay under ${formatBytes(
          recordingGuardrails.maxRecordingBytes,
        )}. Download or discard this draft, then record a shorter take.`,
      )
      return
    }

    setDraftDiscardArmed(false)
    setDraftRestartArmed(false)
    setIsSaving(true)

    try {
      const saved = await uploadRecording({
        blob: recordingBlob,
        thumbnail: thumbnailBlob,
        title,
        durationMs,
        durationSource,
      })
      await loadLibrary()
      setSelectedId(saved.id)
      setSelectedTitle(saved.title)
      applyShareDefaults(saved)
      resetRecording()
      setShareDialogOpen(true)
      setShareStatus('Saved. Share link ready when you are.')
      setTitle(`Recording ${new Date().toLocaleDateString()}`)
      setDraftSaveError(null)
    } catch (caughtError) {
      setDraftSaveError(caughtError instanceof Error ? caughtError.message : 'Draft could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }, [
    applyShareDefaults,
    durationMs,
    durationSource,
    isDraftTooLarge,
    loadLibrary,
    recordingBlob,
    recordingGuardrails.maxRecordingBytes,
    resetRecording,
    thumbnailBlob,
    title,
  ])

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

      if (nextUrl) {
        await copyShareLink(nextUrl, isUpdating ? 'Share link updated and copied.' : 'Share link created and copied.')
      } else {
        setShareStatus(isUpdating ? 'Share link updated.' : 'Share link created.')
      }
    },
    [
      applyShareDefaults,
      copyShareLink,
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
          onCreateBackup={handleCreateBackup}
          isBackingUp={isBackingUp}
          backupStatus={backupStatus}
          backups={backups}
          backupPreview={backupPreview}
          onPreviewBackup={handlePreviewBackup}
          isPreviewingBackup={isPreviewingBackup}
          onRestoreBackup={handleRestoreBackup}
          isRestoringBackup={isRestoringBackup}
          recordingGuardrails={recordingGuardrails}
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

          <div className="recorder-status-banner" aria-label="Recording status">
            <StatusChip
              tone={status === 'recording' ? 'bad' : status === 'paused' ? 'bad' : 'neutral'}
              icon={<Radio size={14} />}
              label={recorderHint.label}
            />
            <p>{recorderHint.detail}</p>
          </div>
          {recorderNextHint ? (
            <p className="recorder-next-hint" aria-label="Recorder next-step hint" role="note" aria-live="polite">
              <span>Next:</span> {recorderNextHint}
            </p>
          ) : null}
          {recorderActionCues.length ? (
            <div className="recorder-action-path" aria-label="Recorder action path" role="note" aria-live="polite">
              {recorderActionCues.map((cue) => (
                <span className={`action-cue ${cue.tone}`} key={cue.label}>
                  {cue.icon}
                  {cue.label}
                </span>
              ))}
            </div>
          ) : null}
          <ol className="recorder-phase-meter" aria-label="Capture phase meter">
            {recorderPhaseSteps.map((phase) => (
              <li
                className={`phase-step ${phase.active ? 'active' : ''} ${phase.complete ? 'complete' : ''}`}
                key={phase.id}
                aria-current={phase.active ? 'step' : undefined}
              >
                <span aria-hidden="true">{phase.complete ? <Check size={14} /> : phase.icon}</span>
                <strong>{phase.label}</strong>
              </li>
            ))}
          </ol>

          <section className="recorder-preflight" aria-label="Recorder preflight">
            <div className="preflight-copy">
              <span>Preflight</span>
              <strong>Check storage, source, and inputs before recording.</strong>
            </div>
            <div className="preflight-grid">
              {recorderPreflight.map((item) => (
                <span className={`preflight-item ${item.tone}`} key={item.label}>
                  <span className="preflight-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="preflight-text">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </span>
                </span>
              ))}
            </div>
          </section>

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
                <span>Get ready</span>
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
            <div className="capture-readout" aria-label="Capture status">
              <span className={`readout-pill ${screenReady ? 'ready' : 'warning'}`}>
                <Radio size={16} />
                Source: {screenReady ? 'Armed' : 'None'}
              </span>
              <span className={`readout-pill ${micEnabled ? 'ready' : ''}`}>
                <Mic size={16} />
                Mic: {micEnabled ? 'On' : 'Off'}
              </span>
              <span className={`readout-pill ${cameraEnabled ? 'ready' : ''}`}>
                <Camera size={16} />
                Camera: {cameraEnabled ? 'On' : 'Off'}
              </span>
              <span
                className={`readout-pill ${screenReady ? 'ready' : status === 'error' ? 'warning' : ''}`}
                title="Capture readiness"
              >
                <Radio size={16} />
                Capture: {status === 'error' ? 'Needs attention' : screenReady ? 'Ready' : 'Source required'}
              </span>
              <span className="readout-pill" title="Elapsed time">
                <Clock size={16} />
                Time: {formatTime(elapsedMs)}
              </span>
            </div>
            <div className="capture-input-status" aria-label="Capture input status">
              <span className={`input-status ${screenReady ? 'ready' : 'missing'}`} title="Screen source">
                <MonitorUp size={16} />
                Screen: {screenReady ? 'Selected' : 'Not selected'}
              </span>
              <span className={`input-status ${micEnabled ? 'ready' : 'missing'}`} title="Microphone capture">
                <Mic size={16} />
                Mic: {micEnabled ? 'Enabled' : 'Disabled'}
              </span>
              <span className={`input-status ${cameraEnabled ? 'ready' : 'missing'}`} title="Camera overlay">
                <Video size={16} />
                Camera: {cameraEnabled ? 'Enabled' : 'Disabled'}
              </span>
              <span className={`input-status ${status === 'error' || !screenReady ? 'missing' : 'ready'}`}>
                <Radio size={16} />
                Capture: {status === 'error' ? 'Needs attention' : screenReady ? 'Ready' : 'Source required'}
              </span>
            </div>

            {canClearCaptureState ? (
              <button
                className="secondary-button compact"
                type="button"
                onClick={handleClearCaptureState}
                title="Clear mic and camera selection to return to defaults"
              >
                <X size={16} />
                Clear capture setup
              </button>
            ) : null}

            {status === 'recording' ? (
              <>
                <button className="secondary-button" type="button" onClick={handlePauseRecording}>
                  <Pause size={17} />
                  Pause
                </button>
                <button className="danger-button" type="button" onClick={handleStopRecording}>
                  <Square size={17} fill="currentColor" />
                  Stop
                </button>
                <button className="danger-outline-button" type="button" onClick={handleArmCaptureDiscard}>
                  <Trash2 size={16} />
                  Cancel
                </button>
              </>
            ) : null}

            {status === 'paused' ? (
              <>
                <button className="primary-button" type="button" onClick={handleResumeRecording}>
                  <Play size={17} fill="currentColor" />
                  Resume
                </button>
                <button className="danger-button" type="button" onClick={handleStopRecording}>
                  <Square size={17} fill="currentColor" />
                  Stop
                </button>
                <button className="danger-outline-button" type="button" onClick={handleArmCaptureDiscard}>
                  <Trash2 size={16} />
                  Cancel
                </button>
              </>
            ) : null}

            {status === 'requesting' || status === 'countdown' ? (
              <button className="danger-outline-button" type="button" onClick={handleArmCaptureDiscard}>
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

          {captureDiscardPending ? (
            <section className="capture-discard-card" aria-label="Discard live capture" role="status">
              <div className="capture-discard-copy">
                <strong>Discard live take?</strong>
                <p>Keep recording if this was a miss-click. Discard stops capture and removes the draft.</p>
              </div>
              <div className="capture-discard-actions">
                <button className="secondary-button compact" type="button" onClick={handleKeepCapture}>
                  <Play size={16} />
                  Keep recording
                </button>
                <button className="danger-button compact" type="button" onClick={handleConfirmCaptureDiscard}>
                  <Trash2 size={16} />
                  Discard take
                </button>
              </div>
            </section>
          ) : null}

          {draftRestartPending ? (
            <section className="draft-restart-card" aria-label="Start new take" role="status">
              <div className="draft-restart-copy">
                <strong>Start a new take?</strong>
                <p>This draft is still local. Keep it to save or share, or discard it and open capture again.</p>
              </div>
              <div className="draft-restart-actions">
                <button className="secondary-button compact" type="button" onClick={handleKeepDraftForRestart}>
                  <Save size={16} />
                  Keep draft
                </button>
                <button className="danger-button compact" type="button" onClick={handleConfirmDraftRestart}>
                  <MonitorUp size={16} />
                  Discard draft & record
                </button>
              </div>
            </section>
          ) : null}

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
              <div className="draft-state" aria-label="Draft status">
                <StatusChip icon={<Lock size={15} />} label="Unsaved local draft" tone="neutral" />
                <StatusChip icon={<Clock size={15} />} label={`${formatTime(durationMs ?? 0)} captured`} tone="neutral" />
                <StatusChip icon={<Video size={15} />} label={formatDurationSourceLabel(durationSource)} tone="neutral" />
                <StatusChip
                  icon={isDraftTooLarge ? <AlertTriangle size={15} /> : <HardDrive size={15} />}
                  label={`${formatBytes(recordingBlob?.size ?? 0)} draft`}
                  tone={isDraftTooLarge ? 'bad' : 'neutral'}
                />
                {isLongDraft ? (
                  <StatusChip icon={<Clock size={15} />} label="Long draft" tone="neutral" />
                ) : null}
                <StatusChip icon={<Link2 size={15} />} label="Share after save" tone="neutral" />
              </div>
              {isDraftTooLarge ? (
                <p className="inline-error" aria-live="polite">
                  Draft is over the {formatBytes(recordingGuardrails.maxRecordingBytes)} single-recording limit.
                </p>
              ) : null}
              {isLongDraft && !isDraftTooLarge ? (
                <p className="guardrail-note" aria-live="polite">
                  Long take. Save before starting another recording and keep D-drive space above{' '}
                  {formatStorageBytes(recordingGuardrails.storageWarningThresholdBytes)}.
                </p>
              ) : null}
              <section className="review-momentum" aria-label="Review momentum">
                <div className="review-momentum-copy">
                  <strong>Draft ready</strong>
                  <p>Save locks this take into the library and opens sharing.</p>
                </div>
                <ol className="review-path">
                  <li className="complete">
                    <span aria-hidden="true"><Check size={14} /></span>
                    Preview
                  </li>
                  <li className="active">
                    <span aria-hidden="true"><Save size={14} /></span>
                    Save
                  </li>
                  <li>
                    <span aria-hidden="true"><Link2 size={14} /></span>
                    Share
                  </li>
                </ol>
              </section>
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
                  disabled={!recordingBlob || isSaving || isDraftTooLarge}
                >
                  {isSaving ? <UploadCloud size={17} /> : <Save size={17} />}
                  {isSaving ? 'Saving' : 'Save & open Share'}
                </button>
              </div>
              {draftSaveError ? (
                <p className="inline-error" aria-live="polite">
                  {draftSaveError}
                </p>
              ) : null}
              <div className="review-actions">
                {previewUrl ? (
                  <a className="secondary-link" href={previewUrl} download={`${normalizeFileName(title)}.webm`}>
                    <Download size={16} />
                    Download draft
                  </a>
                ) : null}
                {draftDiscardArmed ? (
                  <div className="draft-confirmation" role="status">
                    <span>Discard this draft?</span>
                    <button
                      className="secondary-button compact"
                      type="button"
                      onClick={() => setDraftDiscardArmed(false)}
                    >
                      Keep draft
                    </button>
                    <button className="danger-button compact" type="button" onClick={handleDiscardDraft}>
                      Confirm discard
                    </button>
                  </div>
                ) : (
                  <button className="danger-outline-button compact" type="button" onClick={handleDiscardDraft}>
                    <Trash2 size={16} />
                    Discard
                  </button>
                )}
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

          {recordings.length ? (
            <div className="library-tools" aria-label="Library tools">
              <label htmlFor="library-search">Search</label>
              <input
                id="library-search"
                value={libraryQuery}
                onChange={(event) => setLibraryQuery(event.target.value)}
                placeholder="Title, shared, private, revoked"
              />
              {libraryQuery ? (
                <button className="secondary-button compact" type="button" onClick={() => setLibraryQuery('')}>
                  Clear
                </button>
              ) : null}
              <label htmlFor="library-sort">Sort</label>
              <select
                id="library-sort"
                value={librarySort}
                onChange={(event) => setLibrarySort(event.target.value as LibrarySort)}
              >
                <option value="newest">Newest</option>
                <option value="title">Name</option>
                <option value="share">Share state</option>
              </select>
            </div>
          ) : null}

          <div className="recording-list">
            {visibleRecordings.map((recording) => {
              const shareState = getRecordingShareState(recording)

              return (
                <button
                  className={`recording-row ${recording.id === selectedRecording?.id ? 'selected' : ''}`}
                  key={recording.id}
                  type="button"
                  onClick={() => handleSelectRecording(recording)}
                >
                  <span className={`row-icon ${recording.thumbnailUrl ? 'poster' : ''}`} aria-hidden="true">
                    {recording.thumbnailUrl ? (
                      <img alt="" src={recording.thumbnailUrl} loading="lazy" />
                    ) : (
                      <Play size={16} fill="currentColor" />
                    )}
                  </span>
                  <span>
                    <strong>{recording.title}</strong>
                    <small>
                      {formatDate(recording.createdAt)} / {formatBytes(recording.sizeBytes)}
                    </small>
                  </span>
                  <span className={`row-status ${shareState === 'private' ? '' : shareState}`}>
                    {capitalizeShareState(shareState)}
                  </span>
                </button>
              )
            })}

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

            {recordings.length && !visibleRecordings.length ? (
              <div className="empty-library">
                <ListChecks size={22} />
                <span>No matching recordings</span>
                <p>Try another title or sharing state.</p>
                <button className="secondary-button compact" type="button" onClick={() => setLibraryQuery('')}>
                  Clear search
                </button>
              </div>
            ) : null}
          </div>

          {selectedRecording ? (
            <section className="viewer-panel" aria-label="Selected recording">
              <video
                key={selectedRecording.id}
                className="library-video"
                src={`/api/recordings/${selectedRecording.id}/video`}
                poster={selectedRecording.thumbnailUrl ?? undefined}
                controls
                playsInline
              />
              <div className="viewer-meta">
                <div>
                  <strong>{selectedRecording.title}</strong>
                  <small>{formatDurationLabel(selectedRecording.durationMs)}</small>
                </div>
                <StatusChip
                  tone={getShareStateTone(selectedShareState)}
                  icon={
                    selectedShareState === 'shared' ? (
                      <Link2 size={15} />
                    ) : selectedShareState === 'expired' ? (
                      <Clock size={15} />
                    ) : (
                      <Lock size={15} />
                    )
                  }
                  label={capitalizeShareState(selectedShareState)}
                />
              </div>
              <div className="viewer-share-overview" aria-label="Share state overview">
                <StatusChip
                  tone={getShareStateTone(selectedShareState)}
                  icon={
                    selectedShareState === 'shared' ? (
                      <Link2 size={15} />
                    ) : selectedShareState === 'expired' ? (
                      <Clock size={15} />
                    ) : (
                      <Lock size={15} />
                    )
                  }
                  label={getRecordingShareSummary(selectedRecording)}
                />
                <p className="viewer-share-line">{selectedShareHint}</p>
              </div>
              {selectedOwnerPathAction ? (
                <section className="owner-path-card" aria-label="Owner path">
                  <div className="owner-path-copy">
                    <strong>{selectedOwnerPathAction.label}</strong>
                    <p>{selectedOwnerPathAction.hint}</p>
                  </div>
                  <button
                    className="primary-button compact"
                    type="button"
                    onClick={() => {
                      if (selectedOwnerPathAction.type === 'copy-link' && selectedActiveShareUrl) {
                        void copyShareLink(selectedActiveShareUrl)
                        return
                      }

                      applyShareDefaults(selectedRecording)
                      setShareDialogOpen(true)
                    }}
                  >
                    {selectedOwnerPathAction.actionLabel}
                  </button>
                </section>
              ) : null}
              <dl className="viewer-facts" aria-label="Recording details">
                <div>
                  <dt>Created</dt>
                  <dd>{formatDate(selectedRecording.createdAt)}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{formatDate(selectedRecording.updatedAt)}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{formatBytes(selectedRecording.sizeBytes)}</dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>{formatDurationLabel(selectedRecording.durationMs)}</dd>
                </div>
                <div>
                  <dt>Duration source</dt>
                  <dd>{formatDurationSourceLabel(selectedRecording.durationSource)}</dd>
                </div>
                <div>
                  <dt>Poster</dt>
                  <dd>{selectedRecording.thumbnailUrl ? 'Captured' : 'Not captured'}</dd>
                </div>
                <div>
                  <dt>Views</dt>
                  <dd>{selectedRecording.viewCount}</dd>
                </div>
                <div>
                  <dt>Expiry</dt>
                  <dd>{formatShareExpirySummary(selectedRecording.shareExpiresAt ?? '')}</dd>
                </div>
                <div>
                  <dt>Access</dt>
                  <dd>{selectedRecording.sharePasswordProtected ? 'Password required' : 'No password'}</dd>
                </div>
                <div>
                  <dt>Downloads</dt>
                  <dd>{selectedRecording.shareDownloadEnabled ? 'Allowed' : 'Playback only'}</dd>
                </div>
                <div>
                  <dt>Link</dt>
                  <dd>{getRecordingShareSummary(selectedRecording)}</dd>
                </div>
                <div>
                  <dt>Share state</dt>
                  <dd>{capitalizeShareState(selectedShareState)}</dd>
                </div>
              </dl>
              <p className="viewer-guidance">{getRecordingNextStep(selectedRecording)}</p>
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
                {selectedActiveShareUrl ? (
                  <button
                    className="secondary-button compact"
                    type="button"
                    onClick={() => {
                      void copyShareLink(selectedActiveShareUrl)
                    }}
                  >
                    <Copy size={16} />
                    Copy link
                  </button>
                ) : null}
                {selectedActiveShareUrl ? (
                  <a className="secondary-link compact" href={selectedActiveShareUrl} target="_blank" rel="noreferrer">
                    <Eye size={16} />
                    View as guest
                  </a>
                ) : null}
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
              void copyShareLink(shareUrl)
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
  onCreateBackup,
  isBackingUp,
  backupStatus,
  backups,
  backupPreview,
  onPreviewBackup,
  isPreviewingBackup,
  onRestoreBackup,
  isRestoringBackup,
  recordingGuardrails,
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
  onCreateBackup: () => void
  isBackingUp: boolean
  backupStatus: string | null
  backups: LibraryBackup[]
  backupPreview: LibraryBackupPreview | null
  onPreviewBackup: (backup: LibraryBackup) => void
  isPreviewingBackup: boolean
  onRestoreBackup: (backup: LibraryBackupPreview) => void
  isRestoringBackup: boolean
  recordingGuardrails: AppConfig['recordingGuardrails']
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
      <StorageHealthCard
        storageHealth={appConfig?.storageHealth ?? null}
        onCreateBackup={onCreateBackup}
        isBackingUp={isBackingUp}
        backupStatus={backupStatus}
        backups={backups}
        backupPreview={backupPreview}
        onPreviewBackup={onPreviewBackup}
        isPreviewingBackup={isPreviewingBackup}
        onRestoreBackup={onRestoreBackup}
        isRestoringBackup={isRestoringBackup}
        recordingGuardrails={recordingGuardrails}
      />
    </aside>
  )
}

function StorageHealthCard({
  storageHealth,
  onCreateBackup,
  isBackingUp,
  backupStatus,
  backups,
  backupPreview,
  onPreviewBackup,
  isPreviewingBackup,
  onRestoreBackup,
  isRestoringBackup,
  recordingGuardrails,
}: {
  storageHealth: AppConfig['storageHealth'] | null
  onCreateBackup: () => void
  isBackingUp: boolean
  backupStatus: string | null
  backups: LibraryBackup[]
  backupPreview: LibraryBackupPreview | null
  onPreviewBackup: (backup: LibraryBackup) => void
  isPreviewingBackup: boolean
  onRestoreBackup: (backup: LibraryBackupPreview) => void
  isRestoringBackup: boolean
  recordingGuardrails: AppConfig['recordingGuardrails']
}) {
  const diskTone = getStorageDiskTone(storageHealth?.disk.status ?? 'unknown')
  const libraryTone = getStorageLibraryTone(storageHealth?.library.status ?? 'unreadable')
  const latestBackup = backups[0] ?? null

  return (
    <section className="storage-health-card" aria-label="Storage health">
      <div className="storage-health-heading">
        <HardDrive size={16} />
        <div>
          <strong>Storage health</strong>
          <p>{getStorageHealthSummary(storageHealth)}</p>
        </div>
      </div>
      <div className="storage-health-chips">
        <StatusChip
          tone={diskTone}
          icon={<HardDrive size={15} />}
          label={storageHealth ? getDiskHealthLabel(storageHealth.disk) : 'Checking space'}
        />
        <StatusChip
          tone={libraryTone}
          icon={<ListChecks size={15} />}
          label={storageHealth ? getLibraryHealthLabel(storageHealth.library) : 'Checking library'}
        />
      </div>
      {storageHealth?.library.indexBackupPath ? (
        <p className="storage-health-detail">
          Corrupt index preserved at {storageHealth.library.indexBackupPath}
        </p>
      ) : null}
      <p className="storage-health-detail">
        Guardrail: {formatBytes(recordingGuardrails.maxRecordingBytes)} per recording. Keep{' '}
        {formatStorageBytes(recordingGuardrails.storageWarningThresholdBytes)} free for long takes.
      </p>
      <div className="storage-health-actions">
        <button
          className="secondary-button compact"
          type="button"
          onClick={onCreateBackup}
          disabled={isBackingUp || !storageHealth}
        >
          <Save size={15} />
          {isBackingUp ? 'Backing up' : 'Back up library'}
        </button>
        <button
          className="secondary-button compact"
          type="button"
          onClick={() => {
            if (latestBackup) {
              onPreviewBackup(latestBackup)
            }
          }}
          disabled={isPreviewingBackup || !latestBackup}
        >
          <Eye size={15} />
          {isPreviewingBackup ? 'Previewing' : 'Preview backup'}
        </button>
      </div>
      {backupStatus ? <p className="storage-health-detail">{backupStatus}</p> : null}
      <div className="storage-health-backup" aria-label="Backup history">
        <strong>Latest backup</strong>
        <p>{latestBackup ? formatBackupHistoryLine(latestBackup) : 'No backups yet'}</p>
      </div>
      {backupPreview ? (
        <BackupPreview
          backup={backupPreview}
          onRestoreBackup={onRestoreBackup}
          isRestoringBackup={isRestoringBackup}
        />
      ) : null}
    </section>
  )
}

function BackupPreview({
  backup,
  onRestoreBackup,
  isRestoringBackup,
}: {
  backup: LibraryBackupPreview
  onRestoreBackup: (backup: LibraryBackupPreview) => void
  isRestoringBackup: boolean
}) {
  const visibleRecordings = backup.recordings.slice(0, 3)
  const canRestoreBackup = backup.status !== 'unreadable' && backup.copiedRecordingFiles > 0

  return (
    <section className="backup-preview" aria-label="Backup preview">
      <strong>Backup preview</strong>
      <p>{formatBackupPreviewSummary(backup)}</p>
      {visibleRecordings.length ? (
        <ul>
          {visibleRecordings.map((recording) => (
            <li key={`${recording.id}-${recording.fileName}`}>
              <span>{recording.title}</span>
              <small>{recording.videoPresent ? 'Video ready' : 'Video missing'}</small>
            </li>
          ))}
        </ul>
      ) : null}
      <p>{backup.privacyNote}</p>
      <button
        className="secondary-button compact"
        type="button"
        onClick={() => onRestoreBackup(backup)}
        disabled={!canRestoreBackup || isRestoringBackup}
      >
        <RotateCcw size={15} />
        {isRestoringBackup ? 'Restoring' : 'Restore private copies'}
      </button>
    </section>
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
  const hasRevokedLink = Boolean(recording.shareWasRevoked && !recording.shareToken)
  const canRecreateLink = recording.shareExpired || hasRevokedLink
  const linkActionLabel = canRecreateLink ? 'Recreate link' : hasAnyShareLink ? 'Update link' : 'Create link'
  const canShareActions = hasActiveShare
  const primaryShareActionLabel = hasActiveShare ? 'Copy guest link' : linkActionLabel
  const shareLinkLabel = recording.shareExpired
    ? 'Share link expired'
    : hasRevokedLink
      ? 'Share link revoked'
      : hasActiveShare
        ? 'Share link active'
        : 'No shared link yet'
  const shareLinkTone: 'good' | 'bad' | 'neutral' = recording.shareExpired || hasRevokedLink
    ? 'bad'
    : hasAnyShareLink
      ? 'good'
      : 'neutral'
  const safeStateHint = (() => {
    if (recording.shareExpired) {
      return 'This share link expired. Recreate it to generate a fresh public URL.'
    }

    if (recording.shareWasRevoked) {
      return 'This share link was revoked. Create a fresh link to share again.'
    }

    if (hasActiveShare) {
      return 'Public link is ready. Copy to share or unshare when access should stop.'
    }

    return 'No active public link. Create one from this recording.'
  })()

  const shouldShowShareLink = hasActiveShare
  const pendingPasswordLabel = passwordEnabled
    ? recording.sharePasswordProtected && !password.trim()
      ? 'Password unchanged'
      : 'Password required'
    : 'No password'
  const pendingExpiryLabel = formatShareExpirySummary(expiresAt)
  const pendingDownloadLabel = downloadEnabled ? 'Downloads allowed' : 'Playback only'
  const copyFallbackVisible = status === copyBlockedStatus && shouldShowShareLink && Boolean(shareUrl)

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
            Require password
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
              aria-label="Share expiry"
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
            Allow downloads
          </label>
        </div>

        <div className="share-settings-preview" aria-label="Share settings summary">
          <StatusChip
            tone={passwordEnabled ? 'good' : 'neutral'}
            icon={passwordEnabled ? <ShieldCheck size={15} /> : <Lock size={15} />}
            label={pendingPasswordLabel}
          />
          <StatusChip
            tone={expiresAt ? 'good' : 'neutral'}
            icon={<Clock size={15} />}
            label={pendingExpiryLabel}
          />
          <StatusChip
            tone={downloadEnabled ? 'good' : 'neutral'}
            icon={<Download size={15} />}
            label={pendingDownloadLabel}
          />
        </div>

        {canShareActions && shareUrl ? (
          <section className="share-ready-card" aria-label="Share ready">
            <div className="share-ready-heading">
              <span className="row-icon" aria-hidden="true">
                <CheckCircle2 size={17} />
              </span>
              <div>
                <strong>Ready to send</strong>
                <p>Guest link is active. Copy it now, preview the guest view, or unshare when access should stop.</p>
              </div>
            </div>
            <ol className="share-ready-steps">
              <li className="complete">
                <span aria-hidden="true"><Check size={14} /></span>
                Link created
              </li>
              <li className="active">
                <span aria-hidden="true"><Copy size={14} /></span>
                Copy link
              </li>
              <li>
                <span aria-hidden="true"><Eye size={14} /></span>
                Review guest view
              </li>
            </ol>
            <div className="share-preview-card" aria-label="Guest preview checklist">
              <div>
                <strong>Preview before sending</strong>
                <p>Open the guest view to confirm playback and access settings before the link leaves your machine.</p>
              </div>
              <a className="secondary-link compact" href={shareUrl} target="_blank" rel="noreferrer">
                <Eye size={16} />
                Preview guest view
              </a>
            </div>
          </section>
        ) : null}

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

        {copyFallbackVisible ? (
          <section className="copy-fallback-card" aria-label="Copy fallback">
            <strong>Clipboard fallback</strong>
            <p>The guest link remains visible above. Select it manually, or open Preview guest view and copy the address bar.</p>
          </section>
        ) : null}

        <div className="dialog-actions">
          <button className="primary-button" type="button" onClick={hasActiveShare ? onCopy : onSave}>
            {hasActiveShare ? <Copy size={16} /> : <Link2 size={16} />}
            {primaryShareActionLabel}
          </button>
          {hasActiveShare ? (
            <button className="secondary-button" type="button" onClick={onSave}>
              <Link2 size={16} />
              Update link
            </button>
          ) : null}
          {canShareActions ? (
            <a className="secondary-link" href={shareUrl ?? ''} target="_blank" rel="noreferrer">
              <Eye size={16} />
              View as guest
            </a>
          ) : null}
          {recording.shareToken ? (
            <button className="danger-outline-button" type="button" onClick={onRevoke}>
              <Trash2 size={16} />
              Unshare
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
        setRecording(null)
        setRequiresPassword(false)
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
              preload="none"
              autoPlay={false}
            />
            <div className="shared-meta">
              <h2>{recording.title}</h2>
              <p>
                {formatDate(recording.createdAt)} / {formatDurationLabel(recording.durationMs)}
              </p>
              <section className="guest-access-card" aria-label="Guest access summary">
                <div className="guest-access-heading">
                  <strong>Guest access</strong>
                  <p>These settings match the active share link from the owner.</p>
                </div>
                <div className="guest-access-grid">
                  <StatusChip
                    tone={recording.sharePasswordProtected ? 'good' : 'neutral'}
                    icon={recording.sharePasswordProtected ? <ShieldCheck size={15} /> : <Lock size={15} />}
                    label={recording.sharePasswordProtected ? 'Password required' : 'No password'}
                  />
                  <StatusChip
                    tone={recording.shareExpiresAt ? 'good' : 'neutral'}
                    icon={<Clock size={15} />}
                    label={formatShareExpirySummary(recording.shareExpiresAt ?? '')}
                  />
                  <StatusChip
                    tone={recording.shareDownloadEnabled ? 'good' : 'neutral'}
                    icon={<Download size={15} />}
                    label={recording.shareDownloadEnabled ? 'Downloads allowed' : 'Playback only'}
                  />
                  <StatusChip tone="neutral" icon={<Eye size={15} />} label={`${recording.viewCount} views`} />
                </div>
              </section>
              {downloadSource ? (
                <a className="download-link" href={downloadSource}>
                  <Download size={16} />
                  Download
                </a>
              ) : null}
            </div>
          </>
        ) : requiresPassword ? (
          <form className="share-gate-card protected" aria-label="Protected share" onSubmit={handlePasswordSubmit}>
            <span className="share-gate-icon" aria-hidden="true">
              <Lock size={24} />
            </span>
            <div className="share-gate-copy">
              <span>Private link</span>
              <h2>Enter the share password</h2>
              <p>
                This recording is protected. ShareFrame keeps the title, playback, and access settings hidden until
                the password is accepted.
              </p>
            </div>
            <div className="share-gate-chips" aria-label="Protected share status">
              <StatusChip tone="neutral" icon={<Lock size={15} />} label="Playback locked" />
              <StatusChip tone="neutral" icon={<ShieldCheck size={15} />} label="Details hidden" />
              <StatusChip tone="neutral" icon={<Eye size={15} />} label="Owner controlled" />
            </div>
            <label className="share-password-field" htmlFor="share-password">
              <span>Share password</span>
              <input
                id="share-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
                autoFocus
              />
            </label>
            <button className="primary-button" type="submit" disabled={isCheckingPassword || !password.trim()}>
              <Lock size={16} />
              {isCheckingPassword ? 'Checking' : 'Unlock share'}
            </button>
            {error ? <p className="inline-error">{error}</p> : null}
          </form>
        ) : (
          <ShareUnavailableState message={error} />
        )}
      </section>
    </main>
  )
}

function ShareUnavailableState({ message }: { message: string | null }) {
  const isLoading = !message

  return (
    <section
      className={`share-gate-card ${isLoading ? 'loading' : 'unavailable'}`}
      aria-label={isLoading ? 'Checking share' : 'Unavailable share'}
    >
      <span className="share-gate-icon" aria-hidden="true">
        {isLoading ? <RefreshCcw size={24} /> : <Link2 size={24} />}
      </span>
      <div className="share-gate-copy">
        <span>{isLoading ? 'Checking link' : 'Access unavailable'}</span>
        <h2>{isLoading ? 'Checking this share link' : message}</h2>
        <p>
          {isLoading
            ? 'ShareFrame is verifying whether this private link is still active.'
            : 'The owner may have revoked, replaced, or expired this link. For privacy, recording details are not shown here.'}
        </p>
      </div>
      <div className="share-gate-chips" aria-label={isLoading ? 'Share check status' : 'Unavailable share status'}>
        <StatusChip tone="neutral" icon={<Lock size={15} />} label="No recording details shown" />
        <StatusChip
          tone={isLoading ? 'neutral' : 'bad'}
          icon={<Link2 size={15} />}
          label={isLoading ? 'Verifying access' : 'Link inactive'}
        />
        <StatusChip
          tone="neutral"
          icon={<ShieldCheck size={15} />}
          label={isLoading ? 'Private by default' : 'Ask owner for a fresh link'}
        />
      </div>
      {!isLoading ? (
        <button className="secondary-button" type="button" onClick={() => window.location.reload()}>
          <RefreshCcw size={16} />
          Check again
        </button>
      ) : null}
    </section>
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

  if (lowered.includes('incorrect password') || lowered.includes('could not unlock share')) {
    return 'Password did not unlock this share.'
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

function getRecorderHint(
  status: RecorderStatus,
  screenReady: boolean,
  micEnabled: boolean,
  cameraEnabled: boolean,
  countdown: number | null,
) {
  if (status === 'recording') {
    return {
      label: 'Recording live',
      detail:
        'Capture active. Pause to stop motion, or keep rolling and Save once you stop.',
    }
  }

  if (status === 'paused') {
    return {
      label: 'Paused',
      detail: 'Capture paused. Resume for more time, or finish then save your draft.',
    }
  }

  if (status === 'countdown') {
    const remaining = countdown ?? 3
    return {
      label: 'Countdown',
      detail: `Starting in ${remaining} second${remaining === 1 ? '' : 's'}. Keep source setup as-is or cancel to abort.`,
    }
  }

  if (status === 'requesting') {
    return {
      label: 'Starting capture',
      detail: 'Browser prompt active. Approve the source and input permissions.',
    }
  }

  if (status === 'ready') {
    return {
      label: 'Review draft',
      detail: 'Review this recording, then save or discard to continue.',
    }
  }

  if (status === 'stopping') {
    return {
      label: 'Wrapping up',
      detail: 'Finishing the capture. Save button will unlock once draft is ready.',
    }
  }

  if (!screenReady) {
    const missing = micEnabled || cameraEnabled ? 'Capture source' : 'Source, mic, and camera'
    return {
      label: 'Waiting',
      detail: `${missing} not ready. Press Record after your input preferences are set.`,
    }
  }

  const enabled: string[] = []
  if (micEnabled) enabled.push('mic')
  if (cameraEnabled) enabled.push('camera')

  if (enabled.length) {
    return {
      label: 'Ready',
      detail: `Capture ready with ${enabled.join(' + ')} enabled. Press Record to begin.`,
    }
  }

  return {
    label: 'Ready',
    detail: 'Press Record to capture your first take.',
  }
}

function getRecorderNextHint(status: RecorderStatus) {
  if (status === 'countdown') {
    return 'Keep source and audio/video channels as-is while countdown completes. Cancel to adjust setup.'
  }

  if (status === 'recording') {
    return 'Pause for a break, or stop when you are ready to review and save.'
  }

  if (status === 'paused') {
    return 'Resume for more time, or stop to open the review draft.'
  }

  if (status === 'ready') {
    return 'Save this draft to add it to your library, or discard to retry.'
  }

  return null
}

function getRecorderActionCues(
  status: RecorderStatus,
  captureDiscardArmed = false,
  draftRestartArmed = false,
) {
  if (draftRestartArmed && status === 'ready') {
    return [
      {
        label: 'Keep draft',
        icon: <Save size={14} />,
        tone: 'primary' as const,
      },
      {
        label: 'Discard + Record',
        icon: <MonitorUp size={14} />,
        tone: 'danger' as const,
      },
    ]
  }

  if (captureDiscardArmed && isCaptureActive(status)) {
    return [
      {
        label: 'Keep recording',
        icon: <Play size={14} fill="currentColor" />,
        tone: 'primary' as const,
      },
      {
        label: 'Discard take',
        icon: <Trash2 size={14} />,
        tone: 'danger' as const,
      },
    ]
  }

  if (status === 'countdown') {
    return [
      {
        label: 'Standby',
        icon: <Clock size={14} />,
        tone: 'neutral' as const,
      },
      {
        label: 'Cancel to adjust setup',
        icon: <X size={14} />,
        tone: 'danger' as const,
      },
    ]
  }

  if (status === 'recording') {
    return [
      {
        label: 'Pause',
        icon: <Pause size={14} />,
        tone: 'secondary' as const,
      },
      {
        label: 'Stop + Review',
        icon: <Square size={14} fill="currentColor" />,
        tone: 'danger' as const,
      },
      {
        label: 'Cancel',
        icon: <Trash2 size={14} />,
        tone: 'danger' as const,
      },
    ]
  }

  if (status === 'paused') {
    return [
      {
        label: 'Resume',
        icon: <Play size={14} fill="currentColor" />,
        tone: 'primary' as const,
      },
      {
        label: 'Stop + Review',
        icon: <Square size={14} fill="currentColor" />,
        tone: 'danger' as const,
      },
      {
        label: 'Cancel',
        icon: <Trash2 size={14} />,
        tone: 'danger' as const,
      },
    ]
  }

  if (status === 'ready') {
    return [
      {
        label: 'Save to library',
        icon: <Save size={14} />,
        tone: 'primary' as const,
      },
      {
        label: 'Discard',
        icon: <Trash2 size={14} />,
        tone: 'danger' as const,
      },
    ]
  }

  return []
}

function getRecorderPreflightItems({
  captureSupported,
  storageCompliant,
  screenReady,
  micEnabled,
  cameraEnabled,
  status,
  recordingGuardrails,
  diskStatus,
}: {
  captureSupported: boolean
  storageCompliant: boolean
  screenReady: boolean
  micEnabled: boolean
  cameraEnabled: boolean
  status: RecorderStatus
  recordingGuardrails: AppConfig['recordingGuardrails']
  diskStatus: AppConfig['storageHealth']['disk']['status']
}): PreflightItem[] {
  const sourceNeedsAttention = status === 'error'

  return [
    {
      label: 'Storage',
      value: storageCompliant ? 'D-drive ready' : 'Move to D:',
      icon: <HardDrive size={16} />,
      tone: storageCompliant ? 'good' : 'bad',
    },
    {
      label: 'Limit',
      value:
        diskStatus === 'low-space'
          ? 'Short takes'
          : `${formatBytes(recordingGuardrails.maxRecordingBytes)} max`,
      icon: diskStatus === 'low-space' ? <AlertTriangle size={16} /> : <ShieldCheck size={16} />,
      tone: diskStatus === 'low-space' ? 'warning' : 'neutral',
    },
    {
      label: 'Browser',
      value: captureSupported ? 'Capture ready' : 'Browser blocked',
      icon: captureSupported ? <CheckCircle2 size={16} /> : <X size={16} />,
      tone: captureSupported ? 'good' : 'bad',
    },
    {
      label: 'Source',
      value: sourceNeedsAttention ? 'Needs attention' : screenReady ? 'Source selected' : 'Choose source',
      icon: <MonitorUp size={16} />,
      tone: sourceNeedsAttention ? 'bad' : screenReady ? 'good' : 'warning',
    },
    {
      label: 'Mic',
      value: micEnabled ? 'Mic on' : 'Mic off',
      icon: <Mic size={16} />,
      tone: micEnabled ? 'good' : 'neutral',
    },
    {
      label: 'Camera',
      value: cameraEnabled ? 'Camera on' : 'Camera off',
      icon: <Camera size={16} />,
      tone: cameraEnabled ? 'good' : 'neutral',
    },
  ]
}

function getRecorderPhaseSteps(status: RecorderStatus) {
  const phases = [
    { id: 'setup', label: 'Setup', icon: <ShieldCheck size={14} /> },
    { id: 'countdown', label: 'Countdown', icon: <Clock size={14} /> },
    { id: 'record', label: 'Record', icon: <Radio size={14} /> },
    { id: 'review', label: 'Review', icon: <FilePenLine size={14} /> },
    { id: 'save', label: 'Save', icon: <Save size={14} /> },
  ]
  const activeId = getRecorderActivePhase(status)
  const activeIndex = phases.findIndex((phase) => phase.id === activeId)

  return phases.map((phase, index) => ({
    ...phase,
    active: phase.id === activeId,
    complete: index < activeIndex,
  }))
}

function getRecorderActivePhase(status: RecorderStatus) {
  if (status === 'countdown') {
    return 'countdown'
  }

  if (status === 'recording' || status === 'paused') {
    return 'record'
  }

  if (status === 'stopping') {
    return 'review'
  }

  if (status === 'ready') {
    return 'save'
  }

  return 'setup'
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
  const clipboardWrite = navigator.clipboard?.writeText

  if (clipboardWrite) {
    try {
      await clipboardWrite.call(navigator.clipboard, value)
      return true
    } catch {
      // Fall through to the legacy selection path below.
    }
  }

  const field = document.createElement('textarea')
  field.value = value
  field.setAttribute('readonly', 'true')
  field.style.position = 'fixed'
  field.style.left = '-9999px'
  document.body.append(field)
  field.select()

  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    field.remove()
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

function formatShareExpirySummary(value: string) {
  if (!value) {
    return 'No expiry'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Expiry set'
  }

  return `Expires ${date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })} ${date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`
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

function getRecordingShareState(recording: Recording): RecordingShareState {
  if (recording.shareToken && recording.shareExpired) {
    return 'expired'
  }

  if (recording.shareToken) {
    return 'shared'
  }

  if (recording.shareWasRevoked) {
    return 'revoked'
  }

  return 'private'
}

function capitalizeShareState(value: RecordingShareState) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}

function getRecordingShareSummary(recording: Recording) {
  const shareState = getRecordingShareState(recording)

  if (shareState === 'shared') {
    return 'Active link'
  }

  if (shareState === 'expired') {
    return 'Expired link'
  }

  if (shareState === 'revoked') {
    return 'Previously revoked'
  }

  return 'Not shared'
}

function getRecordingNextStep(recording: Recording) {
  const shareState = getRecordingShareState(recording)

  if (shareState === 'shared') {
    return 'Next: copy the guest link, review as guest, or unshare when access should end.'
  }

  if (shareState === 'expired') {
    return 'Next: recreate the expired link before sending this recording again.'
  }

  if (shareState === 'revoked') {
    return 'Next: create a fresh link when this recording should be shared again.'
  }

  return 'Next: create a guest link when this take is ready to share.'
}

function getRecordingOwnerPathAction(
  recording: Recording,
  activeShareUrl: string | null,
): { label: string; hint: string; actionLabel: string; type: 'copy-link' | 'open-share-dialog' } {
  const shareState = getRecordingShareState(recording)

  if (shareState === 'shared' && activeShareUrl) {
    return {
      label: 'Share this recording now',
      hint: 'Copy the guest link and send it to your audience.',
      actionLabel: 'Copy guest link',
      type: 'copy-link',
    }
  }

  if (shareState === 'expired' || shareState === 'revoked') {
    return {
      label: 'Share path reset needed',
      hint: 'Recreate or refresh the link before sending this recording again.',
      actionLabel: 'Recreate guest link',
      type: 'open-share-dialog',
    }
  }

  return {
    label: 'Ready to share this recording',
    hint: 'Create a link when you are ready to send it out.',
    actionLabel: 'Create guest link',
    type: 'open-share-dialog',
  }
}

function getRecordingShareOwnerHint(recording: Recording) {
  const shareState = getRecordingShareState(recording)

  if (shareState === 'shared') {
    return 'Active guest link is ready. Use Copy link for instant sharing, or unshare when access should stop.'
  }

  if (shareState === 'expired') {
    return 'This share link expired. Recreate it to generate a fresh guest link.'
  }

  if (shareState === 'revoked') {
    return 'This recording had a link that was revoked. Recreate when you want to share again.'
  }

  return 'This recording is private. Use Share and create a link when you are ready to share it.'
}

function getShareStateTone(value: RecordingShareState): 'good' | 'bad' | 'neutral' {
  if (value === 'shared') {
    return 'good'
  }

  if (value === 'expired' || value === 'revoked') {
    return 'bad'
  }

  return 'neutral'
}

function compareLibraryRecordings(left: Recording, right: Recording, sort: LibrarySort) {
  if (sort === 'title') {
    return compareText(left.title, right.title) || right.createdAt.localeCompare(left.createdAt)
  }

  if (sort === 'share') {
    return (
      getShareStateRank(getRecordingShareState(left)) - getShareStateRank(getRecordingShareState(right)) ||
      compareText(left.title, right.title) ||
      right.createdAt.localeCompare(left.createdAt)
    )
  }

  return right.createdAt.localeCompare(left.createdAt)
}

function getShareStateRank(value: RecordingShareState) {
  if (value === 'shared') {
    return 0
  }

  if (value === 'expired') {
    return 1
  }

  if (value === 'revoked') {
    return 2
  }

  return 3
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: 'base' })
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`
  }

  if (value >= 1024 * 1024 * 1024) {
    return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function getDraftSizeStatus(sizeBytes: number, maxBytes: number) {
  return sizeBytes > maxBytes ? 'too-large' : 'ready'
}

function formatStorageBytes(value: number | null) {
  if (value === null) {
    return 'Unknown'
  }

  if (value >= 1024 * 1024 * 1024) {
    return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
  }

  return formatBytes(value)
}

function getStorageHealthSummary(storageHealth: AppConfig['storageHealth'] | null) {
  if (!storageHealth) {
    return 'Checking local storage and library index.'
  }

  if (storageHealth.disk.status === 'low-space') {
    return `${formatStorageBytes(storageHealth.disk.freeBytes)} free. Clear room before long recordings.`
  }

  if (storageHealth.library.status === 'recovered') {
    return 'Recovered a damaged index and preserved a backup.'
  }

  if (storageHealth.library.status === 'needs-attention') {
    return 'Library has missing local files. Review before release.'
  }

  if (storageHealth.library.status === 'unreadable') {
    return 'Library health could not be checked.'
  }

  return `${formatStorageBytes(storageHealth.disk.freeBytes)} free. Library index ready.`
}

function formatBackupStatus(backup: LibraryBackup) {
  const countLabel = backup.recordingCount === 1 ? '1 recording' : `${backup.recordingCount} recordings`

  if (backup.status === 'complete') {
    return `Backup ready: ${countLabel} copied to ${backup.path}`
  }

  return `Partial backup: ${backup.copiedRecordingFiles}/${backup.recordingCount} videos copied to ${backup.path}`
}

function formatBackupHistoryLine(backup: LibraryBackup) {
  const countLabel = backup.recordingCount === 1 ? '1 recording' : `${backup.recordingCount} recordings`
  const statusLabel =
    backup.status === 'complete'
      ? 'Complete'
      : backup.status === 'partial'
        ? 'Partial'
        : 'Needs attention'

  return `${statusLabel}: ${countLabel} at ${formatDate(backup.createdAt)}. ${backup.path}`
}

function formatBackupPreviewSummary(backup: LibraryBackupPreview) {
  const countLabel = backup.recordingCount === 1 ? '1 recording' : `${backup.recordingCount} recordings`

  if (backup.status === 'complete') {
    return `Complete backup with ${countLabel}. Restore imports private copies only.`
  }

  if (backup.status === 'partial') {
    return `Partial backup with ${backup.copiedRecordingFiles}/${backup.recordingCount} videos present.`
  }

  return 'Backup manifest needs attention before restore.'
}

function formatBackupRestoreStatus(restore: LibraryBackupRestore) {
  const importedLabel =
    restore.importedRecordingCount === 1
      ? '1 private copy restored'
      : `${restore.importedRecordingCount} private copies restored`

  if (restore.restoreStatus === 'partial') {
    return `${importedLabel}. ${restore.skippedRecordingCount} skipped. Old public links stayed off.`
  }

  return `${importedLabel}. Old public links stayed off.`
}

function getDiskHealthLabel(disk: AppConfig['storageHealth']['disk']) {
  if (disk.status === 'unknown') {
    return 'Space unknown'
  }

  if (disk.status === 'low-space') {
    return `Low space: ${formatStorageBytes(disk.freeBytes)}`
  }

  return `Space ready: ${formatStorageBytes(disk.freeBytes)}`
}

function getLibraryHealthLabel(library: AppConfig['storageHealth']['library']) {
  if (library.status === 'recovered') {
    return 'Index recovered'
  }

  if (library.status === 'needs-attention') {
    return 'Files missing'
  }

  if (library.status === 'unreadable') {
    return 'Index unreadable'
  }

  return `${library.recordingCount} indexed`
}

function getStorageDiskTone(status: AppConfig['storageHealth']['disk']['status']): 'good' | 'bad' | 'neutral' {
  if (status === 'ready') {
    return 'good'
  }

  if (status === 'low-space') {
    return 'bad'
  }

  return 'neutral'
}

function getStorageLibraryTone(status: AppConfig['storageHealth']['library']['status']): 'good' | 'bad' | 'neutral' {
  if (status === 'ready') {
    return 'good'
  }

  if (status === 'recovered') {
    return 'neutral'
  }

  return 'bad'
}

function formatTime(value: number) {
  const totalSeconds = Math.floor(value / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatDurationLabel(value: number | null) {
  return value === null ? 'Duration unknown' : `Duration ${formatTime(value)}`
}

function formatDurationSourceLabel(value: RecordingDurationSource) {
  if (value === 'media') {
    return 'Media duration'
  }

  if (value === 'timer') {
    return 'Timer estimate'
  }

  return 'Duration source unknown'
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

