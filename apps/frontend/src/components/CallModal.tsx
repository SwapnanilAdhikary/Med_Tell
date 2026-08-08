import { useEffect, useRef, useState } from 'react'

interface CallModalProps {
  phase: 'ringing' | 'active'
  speaking: boolean
  muted: boolean
  onToggleMute: () => void
  onEnd: () => void
}

function fmtDuration(total: number) {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function CallButton({
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      className={`call-action-btn${active ? ' active' : ''}${disabled ? ' disabled' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      <span className="call-action-icon">{icon}</span>
      <span className="call-action-label">{label}</span>
    </button>
  )
}

export function CallModal({ phase, speaking, muted, onToggleMute, onEnd }: CallModalProps) {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    if (phase !== 'active') {
      startRef.current = null
      setElapsed(0)
      return
    }
    startRef.current = Date.now()
    setElapsed(0)
    const t = setInterval(
      () => setElapsed(Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000)),
      1000,
    )
    return () => clearInterval(t)
  }, [phase])

  return (
    <div className="call-overlay">
      <div className="call-screen">
        <div className="call-statusbar">
          <span className="call-statusbar-time">{nowTime()}</span>
          <span className="call-statusbar-icons">
            <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor">
              <path d="M8 1.5a6 6 0 0 0-6 6h1.4a4.6 4.6 0 0 1 9.2 0H14a6 6 0 0 0-6-6z" />
              <rect x="0.8" y="8.8" width="14.4" height="2.2" rx="1.1" />
            </svg>
          </span>
        </div>

        <div className="call-hero">
          <div className={`call-avatar-wrap ${phase === 'ringing' ? 'ringing' : ''}`}>
            <div className="call-avatar">+</div>
          </div>
          <div className="call-name">MedAssist AI</div>
          <div className={`call-status${phase === 'ringing' ? ' ringing' : ''}`}>
            {phase === 'ringing' ? 'Ringing…' : speaking ? 'Speaking…' : 'On call'}
          </div>
          <div className="call-meta">
            {phase === 'ringing'
              ? 'Connecting you to your health assistant'
              : fmtDuration(elapsed)}
          </div>
        </div>

        <div className="call-controls">
          <CallButton
            icon={
              muted ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 1l22 22" />
                  <path d="M9 9v3a3 3 0 0 0 5.1 2.1" />
                  <path d="M15 9.3V5a3 3 0 0 0-5.8-1" />
                  <path d="M17.4 14.4A6.5 6.5 0 0 0 19 12v-2" />
                  <path d="M19 10v2a7 7 0 0 1-3.9 6.2M12 19v4M8 23h8" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <path d="M12 19v4M8 23h8" />
                </svg>
              )
            }
            label={muted ? 'Unmute' : 'Mute'}
            active={muted}
            onClick={onToggleMute}
          />
          <CallButton
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <circle
                    key={i}
                    cx={3 + (i % 3) * 9}
                    cy={3 + Math.floor(i / 3) * 9}
                    r="2"
                  />
                ))}
              </svg>
            }
            label="Keypad"
            disabled
          />
          <CallButton
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                <path d="M18.3 5.7a9 9 0 0 1 0 12.6" />
              </svg>
            }
            label="Speaker"
            disabled
          />
          <CallButton
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            }
            label="Hold"
            disabled
          />
        </div>

        <div className="call-end-area">
          <button className="call-end-btn" onClick={onEnd} aria-label="End call">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z" />
            </svg>
          </button>
        </div>

        <div className="call-home-indicator" />
      </div>
    </div>
  )
}
