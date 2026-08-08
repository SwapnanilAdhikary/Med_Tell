import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

export interface PickedPoint {
  lat: number
  lng: number
  /** True when the worker tapped the map rather than using a device fix. */
  picked: boolean
  accuracyM?: number
  label?: string
}

interface Action {
  key: string
  icon: string
  title: string
  detail: string
  to?: string
  /** Extra router state, e.g. "start recording as soon as you land". */
  state?: Record<string, unknown>
  soon?: string
}

/**
 * Capture modes, in the order a worker should reach for them: talking beats
 * typing when you are standing in a courtyard holding a baby. The form is last
 * because it is the slowest, not because it is the least reliable.
 */
const ACTIONS: Action[] = [
  {
    key: 'note',
    icon: '📝',
    title: 'Quick note',
    detail: 'Jot something for yourself. Not sent to a doctor.',
    to: '/field/notes/new',
  },
  {
    key: 'agent',
    icon: '📞',
    title: 'Talk to the assistant',
    detail: 'It asks the questions and writes the report for you.',
    soon: 'Needs setup',
  },
  {
    key: 'voice',
    icon: '🎙️',
    title: 'Record the case',
    detail: 'Speak it. You check the text before it is filed.',
    to: '/field',
    state: { startRecording: true },
  },
  {
    key: 'form',
    icon: '🧾',
    title: 'Fill in the form',
    detail: 'Type the details yourself.',
    to: '/field',
  },
]

export function CaptureSheet({
  point,
  onClose,
}: {
  point: PickedPoint
  onClose: () => void
}) {
  const navigate = useNavigate()
  const panel = useRef<HTMLDivElement>(null)
  const first = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    first.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const start = (action: Action) => {
    if (!action.to) return
    // The point travels in router state, so a refresh cannot resurrect a stale pin.
    navigate(action.to, { state: { point, ...action.state } })
  }

  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="sheet"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
      >
        <div className="sheet-head">
          <div>
            <div id="sheet-title" className="sheet-title">
              {point.label ?? 'This location'}
            </div>
            <div className="sheet-sub mono">
              {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
              {point.picked ? ' · pinned on the map' : ''}
              {!point.picked && point.accuracyM != null ? ` · GPS ±${point.accuracyM} m` : ''}
            </div>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <ul className="sheet-list">
          {ACTIONS.map((action, i) => (
            <li key={action.key}>
              <button
                ref={i === 0 ? first : undefined}
                type="button"
                className="sheet-action"
                onClick={() => start(action)}
                disabled={!action.to}
              >
                <span className="sheet-action-icon" aria-hidden="true">
                  {action.icon}
                </span>
                <span className="sheet-action-text">
                  <span className="sheet-action-title">
                    {action.title}
                    {action.soon && <span className="pill pill-neutral">{action.soon}</span>}
                  </span>
                  <span className="sheet-action-detail">{action.detail}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
