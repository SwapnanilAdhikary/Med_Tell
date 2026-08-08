import type { FieldReport, Urgency } from '../../api/types'
import { STATUS_PILL, URGENCIES } from './labels'

export function UrgencyPill({ urgency }: { urgency?: Urgency }) {
  const match = URGENCIES.find((u) => u.value === urgency)
  if (!match) return null
  return <span className={`pill ${match.cls}`}>{match.label}</span>
}

export function StatusPill({ status }: { status: FieldReport['status'] }) {
  const m = STATUS_PILL[status] ?? STATUS_PILL.submitted
  return <span className={`pill ${m.cls}`}>{m.label}</span>
}

/**
 * The honesty field, on screen. An assigned-area centroid must never look like
 * a real fix, so the two never share a colour or a word.
 */
export function GeoChip({ location }: { location: FieldReport['location'] }) {
  if (location.source === 'gps') {
    return (
      <span className="pill pill-info">
        GPS{location.accuracyM != null ? ` ±${location.accuracyM} m` : ''}
      </span>
    )
  }
  if (location.source === 'spoken') {
    return <span className="pill pill-warning">Location as spoken</span>
  }
  return <span className="pill pill-warning">Assigned area (no GPS)</span>
}
