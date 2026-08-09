import { useEffect, useRef, useState } from 'react'
import { getToken } from '../../api/client'

type Phase = 'idle' | 'recording' | 'transcribing' | 'error'

/**
 * Records a clip, sends it for transcription, and hands the text back for the
 * worker to read. It never files anything on its own: a misheard vital must be
 * correctable before a doctor sees it, and a voice note rarely carries a phone
 * number, which the report cannot do without.
 */
export function VoiceRecorder({
  language,
  autoStart,
  onTranscript,
}: {
  language?: string
  autoStart?: boolean
  onTranscript: (text: string) => void
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [seconds, setSeconds] = useState(0)

  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const started = useRef(false)

  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true
      void start()
    }
    // Stop the microphone if the worker navigates away mid-recording.
    return () => {
      recorder.current?.stream.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart])

  useEffect(() => {
    if (phase !== 'recording') return
    const t = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [phase])

  const start = async () => {
    setError('')
    setSeconds(0)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      chunks.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data)
      }
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        void upload(new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' }))
      }
      recorder.current = rec
      rec.start()
      setPhase('recording')
    } catch {
      // Denied, no microphone, or an insecure origin - all the same to the worker.
      setPhase('error')
      setError('Could not use the microphone. Type the details instead.')
    }
  }

  const stop = () => {
    setPhase('transcribing')
    recorder.current?.stop()
  }

  const upload = async (blob: Blob) => {
    const form = new FormData()
    form.append('audio', blob, 'note.webm')
    if (language) form.append('language', language)
    const token = getToken()
    try {
      const res = await fetch('/api/field-reports/transcribe', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      })
      if (!res.ok) throw new Error(`Transcription failed (${res.status})`)
      const body = (await res.json()) as { text?: string }
      if (!body.text?.trim()) throw new Error('Nothing could be heard in that recording')
      onTranscript(body.text.trim())
      setPhase('idle')
    } catch (err) {
      setPhase('error')
      setError(err instanceof Error ? err.message : 'Transcription failed')
    }
  }

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(
    seconds % 60,
  ).padStart(2, '0')}`

  return (
    <div className="recorder">
      {phase === 'recording' ? (
        <button type="button" className="btn btn-danger" onClick={stop}>
          <span className="rec-dot" aria-hidden="true" /> Stop and transcribe · {mmss}
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={start}
          disabled={phase === 'transcribing'}
        >
          🎙️ {phase === 'transcribing' ? 'Transcribing…' : 'Record the case'}
        </button>
      )}
      <span className="field-hint" role="status">
        {phase === 'recording' && 'Say who it is, what you see, and any numbers you measured.'}
        {phase === 'transcribing' && 'Turning your recording into text…'}
        {phase === 'idle' && 'The text lands in the notes box below for you to check.'}
        {phase === 'error' && error}
      </span>
    </div>
  )
}
