import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecorderStatus } from '../types'

type AudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext
}

const frameRate = 30

export function useScreenRecorder() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const displayStreamRef = useRef<MediaStream | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const countdownTimerRef = useRef<number | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const previewUrlRef = useRef<string | null>(null)
  const activeStartedAtRef = useRef(0)
  const elapsedBeforePauseRef = useRef(0)
  const finalDurationRef = useRef(0)
  const discardRecordingRef = useRef(false)
  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [micEnabled, setMicEnabled] = useState(true)
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [screenReady, setScreenReady] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [durationMs, setDurationMs] = useState<number | null>(null)
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null)
  const [thumbnailBlob, setThumbnailBlob] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const getCurrentElapsed = useCallback(() => {
    if (!activeStartedAtRef.current) {
      return elapsedBeforePauseRef.current
    }

    return elapsedBeforePauseRef.current + Date.now() - activeStartedAtRef.current
  }, [])

  const clearElapsedTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const clearCountdownTimer = useCallback(() => {
    if (countdownTimerRef.current !== null) {
      window.clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
    }
  }, [])

  const startElapsedTimer = useCallback(() => {
    clearElapsedTimer()
    timerRef.current = window.setInterval(() => {
      setElapsedMs(getCurrentElapsed())
    }, 250)
  }, [clearElapsedTimer, getCurrentElapsed])

  const cleanupCapture = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    clearElapsedTimer()
    clearCountdownTimer()

    stopStream(displayStreamRef.current)
    stopStream(micStreamRef.current)
    stopStream(cameraStreamRef.current)
    displayStreamRef.current = null
    micStreamRef.current = null
    cameraStreamRef.current = null

    void audioContextRef.current?.close()
    audioContextRef.current = null
    setCountdown(null)
    setScreenReady(false)
  }, [clearCountdownTimer, clearElapsedTimer])

  const replacePreviewUrl = useCallback((blob: Blob | null) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }

    if (!blob) {
      setPreviewUrl(null)
      return
    }

    const nextUrl = URL.createObjectURL(blob)
    previewUrlRef.current = nextUrl
    setPreviewUrl(nextUrl)
  }, [])

  const stopRecording = useCallback(() => {
    clearCountdownTimer()
    const recorder = mediaRecorderRef.current
    finalDurationRef.current = getCurrentElapsed()

    if (recorder?.state === 'recording' || recorder?.state === 'paused') {
      setStatus('stopping')
      recorder.stop()
      return
    }

    cleanupCapture()
    setStatus('idle')
  }, [cleanupCapture, clearCountdownTimer, getCurrentElapsed])

  const pauseRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current

    if (recorder?.state !== 'recording') {
      return
    }

    const elapsed = getCurrentElapsed()
    elapsedBeforePauseRef.current = elapsed
    finalDurationRef.current = elapsed
    activeStartedAtRef.current = 0
    clearElapsedTimer()
    recorder.pause()
    setElapsedMs(elapsed)
    setStatus('paused')
  }, [clearElapsedTimer, getCurrentElapsed])

  const resumeRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current

    if (recorder?.state !== 'paused') {
      return
    }

    activeStartedAtRef.current = Date.now()
    recorder.resume()
    startElapsedTimer()
    setStatus('recording')
  }, [startElapsedTimer])

  const cancelRecording = useCallback(() => {
    discardRecordingRef.current = true
    clearCountdownTimer()
    const recorder = mediaRecorderRef.current

    if (recorder && recorder.state !== 'inactive') {
      finalDurationRef.current = getCurrentElapsed()
      setStatus('stopping')
      recorder.stop()
      return
    }

    cleanupCapture()
    chunksRef.current = []
    mediaRecorderRef.current = null
    activeStartedAtRef.current = 0
    elapsedBeforePauseRef.current = 0
    finalDurationRef.current = 0
    discardRecordingRef.current = false
    setRecordingBlob(null)
    setThumbnailBlob(null)
    setDurationMs(null)
    setElapsedMs(0)
    setStatus('idle')
  }, [cleanupCapture, clearCountdownTimer, getCurrentElapsed])

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('Screen capture is not available in this browser')
      setStatus('error')
      return
    }

    try {
      setStatus('requesting')
      setError(null)
      setRecordingBlob(null)
      setThumbnailBlob(null)
      setDurationMs(null)
      setElapsedMs(0)
      setCountdown(null)
      setScreenReady(false)
      discardRecordingRef.current = false
      activeStartedAtRef.current = 0
      elapsedBeforePauseRef.current = 0
      finalDurationRef.current = 0
      replacePreviewUrl(null)

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: frameRate },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: true,
      })
      displayStreamRef.current = displayStream
      setScreenReady(true)
      displayStream.getVideoTracks()[0]?.addEventListener('ended', stopRecording, { once: true })

      const screenVideo = await makeVideoElement(displayStream)
      const micStream = micEnabled
        ? await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          })
        : null
      micStreamRef.current = micStream

      const cameraStream = cameraEnabled
        ? await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              width: { ideal: 640 },
              height: { ideal: 360 },
              frameRate: { ideal: frameRate },
            },
          })
        : null
      cameraStreamRef.current = cameraStream
      const cameraVideo = cameraStream ? await makeVideoElement(cameraStream) : null

      const canvas = canvasRef.current ?? document.createElement('canvas')
      const width = screenVideo.videoWidth || 1280
      const height = screenVideo.videoHeight || 720
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')

      if (!context) {
        throw new Error('Canvas renderer unavailable')
      }

      const renderFrame = () => {
        drawFrame({ canvas, context, screenVideo, cameraVideo })
        animationFrameRef.current = window.requestAnimationFrame(renderFrame)
      }
      renderFrame()

      const canvasStream = canvas.captureStream(frameRate)
      const mixedAudio = createMixedAudioStream(
        [displayStream, micStream].filter(isMediaStream),
      )
      audioContextRef.current = mixedAudio.audioContext
      const outputStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...mixedAudio.stream.getAudioTracks(),
      ])

      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(outputStream, mimeType ? { mimeType } : undefined)
      mediaRecorderRef.current = recorder
      chunksRef.current = []

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      })

      recorder.addEventListener('stop', () => {
        const nextDurationMs = finalDurationRef.current || getCurrentElapsed()
        const shouldDiscard = discardRecordingRef.current
        const blob = new Blob(chunksRef.current, { type: mimeType || 'video/webm' })
        const thumbnailPromise = shouldDiscard ? Promise.resolve(null) : captureThumbnailBlob(canvas)
        cleanupCapture()
        mediaRecorderRef.current = null
        chunksRef.current = []
        activeStartedAtRef.current = 0
        elapsedBeforePauseRef.current = 0
        finalDurationRef.current = 0
        discardRecordingRef.current = false

        if (shouldDiscard) {
          setDurationMs(null)
          setRecordingBlob(null)
          setThumbnailBlob(null)
          replacePreviewUrl(null)
          setElapsedMs(0)
          setStatus('idle')
          return
        }

        void thumbnailPromise.then((nextThumbnailBlob) => {
          setDurationMs(nextDurationMs)
          setRecordingBlob(blob)
          setThumbnailBlob(nextThumbnailBlob)
          replacePreviewUrl(blob)
          setElapsedMs(nextDurationMs)
          setStatus('ready')
        })
      })

      let remaining = 3
      setCountdown(remaining)
      setStatus('countdown')
      countdownTimerRef.current = window.setInterval(() => {
        remaining -= 1

        if (remaining > 0) {
          setCountdown(remaining)
          return
        }

        clearCountdownTimer()
        setCountdown(null)

        if (discardRecordingRef.current || mediaRecorderRef.current !== recorder) {
          return
        }

        activeStartedAtRef.current = Date.now()
        elapsedBeforePauseRef.current = 0
        finalDurationRef.current = 0
        recorder.start(1000)
        setStatus('recording')
        startElapsedTimer()
      }, 1000)
    } catch (caughtError) {
      cleanupCapture()
      mediaRecorderRef.current = null
      setStatus('error')
      setError(formatCaptureError(caughtError))
    }
  }, [
    cameraEnabled,
    cleanupCapture,
    clearCountdownTimer,
    getCurrentElapsed,
    micEnabled,
    replacePreviewUrl,
    startElapsedTimer,
    stopRecording,
  ])

  const resetRecording = useCallback(() => {
    discardRecordingRef.current = false
    activeStartedAtRef.current = 0
    elapsedBeforePauseRef.current = 0
    finalDurationRef.current = 0
    setRecordingBlob(null)
    setThumbnailBlob(null)
    setDurationMs(null)
    setElapsedMs(0)
    setCountdown(null)
    replacePreviewUrl(null)
    setStatus('idle')
  }, [replacePreviewUrl])

  useEffect(
    () => () => {
      cleanupCapture()
      replacePreviewUrl(null)
    },
    [cleanupCapture, replacePreviewUrl],
  )

  return {
    canvasRef,
    status,
    micEnabled,
    cameraEnabled,
    screenReady,
    countdown,
    elapsedMs,
    durationMs,
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
    toggleMic: () => setMicEnabled((enabled) => !enabled),
    toggleCamera: () => setCameraEnabled((enabled) => !enabled),
    setMicEnabled: (value: boolean) => setMicEnabled(value),
    setCameraEnabled: (value: boolean) => setCameraEnabled(value),
  }
}

function drawFrame({
  canvas,
  context,
  screenVideo,
  cameraVideo,
}: {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  screenVideo: HTMLVideoElement
  cameraVideo: HTMLVideoElement | null
}) {
  context.fillStyle = '#0f1318'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(screenVideo, 0, 0, canvas.width, canvas.height)

  if (cameraVideo) {
    const cameraWidth = Math.max(220, Math.floor(canvas.width * 0.18))
    const cameraHeight = Math.floor(cameraWidth * 0.5625)
    const padding = Math.max(24, Math.floor(canvas.width * 0.018))
    const x = canvas.width - cameraWidth - padding
    const y = canvas.height - cameraHeight - padding
    const radius = Math.max(14, Math.floor(cameraWidth * 0.06))

    context.save()
    roundedRect(context, x, y, cameraWidth, cameraHeight, radius)
    context.clip()
    context.drawImage(cameraVideo, x, y, cameraWidth, cameraHeight)
    context.restore()

    context.strokeStyle = 'rgba(255, 255, 255, 0.84)'
    context.lineWidth = Math.max(3, Math.floor(cameraWidth * 0.014))
    roundedRect(context, x, y, cameraWidth, cameraHeight, radius)
    context.stroke()
  }

}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.lineTo(x + width - radius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + radius)
  context.lineTo(x + width, y + height - radius)
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  context.lineTo(x + radius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - radius)
  context.lineTo(x, y + radius)
  context.quadraticCurveTo(x, y, x + radius, y)
  context.closePath()
}

function createMixedAudioStream(streams: MediaStream[]) {
  const audioStreams = streams.filter((stream) => stream.getAudioTracks().length > 0)

  if (!audioStreams.length) {
    return { audioContext: null, stream: new MediaStream() }
  }

  const AudioContextConstructor =
    window.AudioContext ?? (window as AudioWindow).webkitAudioContext

  if (!AudioContextConstructor) {
    return {
      audioContext: null,
      stream: new MediaStream(audioStreams.flatMap((stream) => stream.getAudioTracks())),
    }
  }

  const audioContext = new AudioContextConstructor()
  const destination = audioContext.createMediaStreamDestination()

  for (const stream of audioStreams) {
    audioContext.createMediaStreamSource(stream).connect(destination)
  }

  return { audioContext, stream: destination.stream }
}

async function makeVideoElement(stream: MediaStream) {
  const video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  await video.play()
  return video
}

function captureThumbnailBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(
        (webpBlob) => {
          if (webpBlob) {
            resolve(webpBlob)
            return
          }

          canvas.toBlob((pngBlob) => resolve(pngBlob), 'image/png')
        },
        'image/webp',
        0.78,
      )
    } catch {
      resolve(null)
    }
  })
}

function pickMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? ''
}

function stopStream(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) {
    track.stop()
  }
}

function isMediaStream(stream: MediaStream | null): stream is MediaStream {
  return stream !== null
}

function formatCaptureError(caughtError: unknown) {
  if (!(caughtError instanceof Error)) {
    return 'Recording could not start. Click Record again and approve a screen or window.'
  }

  if (
    caughtError.name === 'NotAllowedError' ||
    caughtError.message.toLowerCase().includes('permission denied')
  ) {
    return 'Screen capture was denied. Click Record again and approve a screen or window.'
  }

  return caughtError.message || 'Recording could not start. Click Record again and approve a screen or window.'
}
