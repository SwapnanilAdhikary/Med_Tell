import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CallModal } from '../CallModal'
import {
  isCallConfigured,
  startCall,
  stopCall,
  toggleMute,
  type FieldCallOutcome,
} from '../../api/call'
import { startRingtone, stopRingtone } from '../../audio/ringtone'
import type { PickedPoint } from './CaptureSheet'

type Phase = 'idle' | 'ringing' | 'active' | 'filing' | 'done' | 'error'

export function FieldCall() {
  const navigate = useNavigate()
  const point = (useLocation().state as { point?: PickedPoint } | null)?.point

  const [phase, setPhase] = useState<Phase>('idle')
  const [speaking, setSpeaking] = useState(false)
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState<FieldCallOutcome | null>(null)
  const unsubscribe = useRef<(() => void) | null>(null)
  const started = useRef(false)

  const teardown = useCallback(() => {
    stopRingtone()
    unsubscribe.current?.()
    unsubscribe.current = null
  }, [])

  const begin = useCallback(async () => {
    setError('')
    if (!isCallConfigured()) {
      setPhase('error')
      setError(
        'Voice calling is not configured. Add VITE_VAPI_PUBLIC_KEY to apps/frontend/.env and restart the dev server.',
      )
      return
    }
    setPhase('ringing')
    startRingtone()
    try {
      unsubscribe.current = await startCall<FieldCallOutcome>(
        'en',
        {
          onStartSuccess: () => {
            stopRingtone()
            setPhase('active')
          },
          onStartFailed: (e) => {
            stopRingtone()
            setPhase('error')
            setError(e)
          },
          // The transcript is posted after call-end, so this is not the finish.
          onCallEnd: () => {
            stopRingtone()
            setPhase('filing')
          },
          onSpeechStart: () => setSpeaking(true),
          onSpeechEnd: () => setSpeaking(false),
          onSummarized: (result) => {
            setOutcome(result)
            setPhase('done')
          },
          onSummariseFailed: (message) => {
            setPhase('error')
            setError(message)
          },
          onNothingHeard: () => {
            setPhase('error')
            setError('Nothing was heard on that call, so nothing was filed.')
          },
        },
        {
          sessionPath: '/api/calls/session/field',
          completePath: '/api/calls/complete/field',
          extra: point
            ? { geo: { lat: point.lat, lng: point.lng, picked: point.picked } }
            : {},
        },
      )
    } catch (e) {
      stopRingtone()
      setPhase('error')
      setError(e instanceof Error ? e.message : 'The call could not be started')
    }
  }, [point])

  useEffect(() => {
    if (!started.current) {
      started.current = true
      void begin()
    }
  }, [begin])

  useEffect(() => {
    // Leaving mid-call must hang up. Unsubscribing alone would remove the
    // call-end listener that posts the transcript, losing the whole report.
    return () => {
      void stopCall()
      teardown()
    }
  }, [teardown])

  const end = () => {
    setPhase('filing')
    // Stop first, so call-end still fires and the transcript is posted.
    void stopCall()
  }

  if (phase === 'ringing' || phase === 'active') {
    return (
      <>
        <div className="content">
          <div className="card">
            <div className="card-title">Talking to the assistant</div>
            <div className="card-sub">
              It will ask you one question at a time. Hang up when you are done.
            </div>
          </div>
        </div>
        <CallModal
          title="MedAssist Field Assistant"
          subtitle="Connecting you to the field assistant"
          phase={phase === 'active' ? 'active' : 'ringing'}
          speaking={speaking}
          muted={muted}
          onToggleMute={() => setMuted(toggleMute())}
          onEnd={end}
        />
      </>
    )
  }

  return (
    <div className="content" style={{ maxWidth: 640 }}>
      <div className="card">
        {phase === 'filing' && (
          <>
            <span className="pill pill-neutral">Working</span>
            <h2 className="card-title" style={{ marginTop: 12 }}>
              Reading back what you said…
            </h2>
            <div className="card-sub">
              Deciding whether this is a report for a doctor or a note for you.
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <span className="pill pill-danger">Not filed</span>
            <h2 className="card-title" style={{ marginTop: 12 }}>
              That call could not be filed
            </h2>
            <div className="card-sub">{error}</div>
            <div className="call-outcome-actions">
              <button className="btn btn-primary" onClick={() => void begin()}>
                Try the call again
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => navigate('/field', { state: { point } })}
              >
                Fill in the form instead
              </button>
            </div>
          </>
        )}

        {phase === 'done' && outcome?.kind === 'report' && (
          <>
            <span className="pill pill-success">Report filed</span>
            <h2 className="card-title" style={{ marginTop: 12 }}>
              Sent to a doctor
            </h2>
            <div className="action-card" style={{ marginTop: 12, maxWidth: 'none' }}>
              {outcome.matchedDoctor
                ? `Matched with Dr. ${outcome.matchedDoctor.name} (${outcome.matchedDoctor.specialty}). They have been notified.`
                : 'No doctor is on the roster yet, so nobody has been notified. Tell your supervisor.'}
            </div>
            {outcome.subjectReachable === false && (
              <div className="action-card" style={{ marginTop: 8, maxWidth: 'none' }}>
                No phone number was recorded for them, so the doctor&apos;s reply comes
                to you to pass on.
              </div>
            )}
            {!point && (
              <div className="action-card" style={{ marginTop: 8, maxWidth: 'none' }}>
                Tagged to your assigned area, not to this house — the call was not
                started from a point on the map.
              </div>
            )}
            <div className="call-outcome-actions">
              {outcome.reportId && (
                <Link className="btn btn-primary" to={`/field/reports/${outcome.reportId}`}>
                  Open the report
                </Link>
              )}
              <Link className="btn btn-secondary" to="/field/map">
                Back to the map
              </Link>
            </div>
          </>
        )}

        {phase === 'done' && outcome?.kind === 'note' && (
          <>
            <span className="pill pill-info">Saved as a note</span>
            <h2 className="card-title" style={{ marginTop: 12 }}>
              Kept for you, not sent to a doctor
            </h2>
            <div className="card-sub">
              That did not sound like a report about a person, so it is in your notes.
            </div>
            <div className="call-outcome-actions">
              {outcome.noteId && (
                <Link className="btn btn-primary" to={`/field/notes/${outcome.noteId}`}>
                  Open the note
                </Link>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => navigate('/field', { state: { point } })}
              >
                File it as a report instead
              </button>
            </div>
          </>
        )}

        {phase === 'idle' && <div className="loading">Starting the call…</div>}
      </div>
    </div>
  )
}
