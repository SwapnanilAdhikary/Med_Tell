import { useState } from 'react'
import type { FieldReportVitals, Urgency } from '../../api/types'
import { vitalLines } from '../field/labels'
import { GeoChip, UrgencyPill } from '../field/pills'

export interface RxItem {
  name: string
  dose?: string
  frequency?: string
  durationDays?: number
  instructions?: string
  tpgList?: string
}

export interface RxFlag {
  severity: 'block' | 'warn' | 'info'
  role: string
  message?: string
  itemName?: string
}

/**
 * Denormalised at creation by PrescriptionsService.request, so rendering this
 * card needs no extra endpoint and no populate.
 *
 * ponytail: aiOutput is a snapshot. A later edit to the field report won't show
 * here; the live view is the worker's /field/reports/:id.
 */
export interface RxRender {
  prescriptionId?: string
  consultMode?: string
  subject?: {
    name?: string
    ageYears?: number | null
    ageMonths?: number | null
    gender?: string | null
    pregnant?: boolean | null
  }
  symptoms?: string[]
  vitals?: FieldReportVitals
  dangerSigns?: string[]
  urgency?: Urgency
  suspectedCondition?: string
  reportedBy?: {
    workerName?: string
    cadre?: string
    village?: string
    facilityName?: string
  }
  geo?: {
    source: 'gps' | 'picked' | 'assigned' | 'spoken'
    accuracyM?: number
    coordinates?: number[]
    village?: string
    block?: string
    district?: string
  }
  matchedDoctor?: { name?: string; specialty?: string }
  draftItems?: RxItem[]
  flags?: RxFlag[]
  failedRoles?: string[]
  summary?: string
  advice?: string
  followUp?: string
}

const FLAG_PILL: Record<RxFlag['severity'], string> = {
  block: 'pill-danger',
  warn: 'pill-warning',
  info: 'pill-info',
}

function ageText(s: RxRender['subject']): string {
  if (!s) return ''
  if (s.ageYears != null) return `${s.ageYears} yrs`
  if (s.ageMonths != null) return `${s.ageMonths} mo`
  return ''
}

function itemLine(item: RxItem): string {
  const tokens = [
    item.dose,
    item.frequency,
    item.durationDays != null ? `${item.durationDays} days` : '',
    item.instructions,
  ].filter(Boolean)
  return tokens.length > 0 ? `${item.name} — ${tokens.join(' · ')}` : item.name
}

export function PrescriptionTask({
  render,
  busy,
  onApprove,
  onApproveEdited,
  onReject,
}: {
  render: RxRender
  busy: boolean
  onApprove: (comment?: string) => void
  onApproveEdited: (items: RxItem[], comment?: string) => void
  onReject: (comment?: string) => void
}) {
  const draft = render.draftItems ?? []
  const [editing, setEditing] = useState(false)
  const [items, setItems] = useState<RxItem[]>(draft)
  const [comment, setComment] = useState('')

  const flags = render.flags ?? []
  const blockers = flags.filter((f) => f.severity === 'block')
  const vitals = vitalLines(render.vitals)
  const coords = render.geo?.coordinates
  // GeoJSON [lng, lat]; Google Maps wants lat,lng.
  const mapsHref =
    coords && coords.length === 2
      ? `https://www.google.com/maps?q=${coords[1]},${coords[0]}`
      : undefined

  const setItem = (i: number, patch: Partial<RxItem>) =>
    setItems((list) => list.map((it, n) => (n === i ? { ...it, ...patch } : it)))

  const area = [render.geo?.village, render.geo?.block, render.geo?.district]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="item-main">
      <div className="rx-head">
        <span className="item-title">
          {render.subject?.name ?? 'Patient'}
          {ageText(render.subject) ? `, ${ageText(render.subject)}` : ''}
          {render.subject?.gender ? `, ${render.subject.gender}` : ''}
        </span>
        <UrgencyPill urgency={render.urgency} />
        {render.subject?.pregnant && <span className="pill pill-warning">Pregnant</span>}
        {render.geo && <GeoChip location={render.geo} />}
        {mapsHref && (
          <a className="rx-maps" href={mapsHref} target="_blank" rel="noreferrer">
            Open in Maps
          </a>
        )}
      </div>

      {render.reportedBy?.workerName && (
        <div className="item-meta">
          Reported by {render.reportedBy.workerName}
          {render.reportedBy.cadre ? ` (${render.reportedBy.cadre})` : ''}
          {area ? ` · ${area}` : ''}
          {render.reportedBy.facilityName ? ` · ${render.reportedBy.facilityName}` : ''}
        </div>
      )}

      {render.suspectedCondition && (
        <div className="item-desc">
          <span style={{ fontWeight: 600 }}>Suspected:</span> {render.suspectedCondition}
        </div>
      )}
      {render.symptoms && render.symptoms.length > 0 && (
        <div className="item-desc">
          <span style={{ fontWeight: 600 }}>Symptoms:</span> {render.symptoms.join(', ')}
        </div>
      )}

      {render.dangerSigns && render.dangerSigns.length > 0 && (
        <div className="rx-head" style={{ marginTop: 6 }}>
          {render.dangerSigns.map((d) => (
            <span key={d} className="pill pill-danger">
              {d}
            </span>
          ))}
        </div>
      )}

      {vitals.length > 0 && (
        <div className="grid grid-4" style={{ marginTop: 10 }}>
          {vitals.map((v) => (
            <div key={v.label} className="stat">
              <div className="stat-label">{v.label}</div>
              <div className="stat-value">{v.value}</div>
            </div>
          ))}
        </div>
      )}

      {flags.length > 0 && (
        <div className="rx-head" style={{ marginTop: 10 }}>
          {flags.map((f, i) => (
            <span key={`${f.role}-${i}`} className={`pill ${FLAG_PILL[f.severity]}`}>
              {f.message ?? `${f.role}: ${f.severity}`}
            </span>
          ))}
        </div>
      )}

      {render.failedRoles && render.failedRoles.length > 0 && (
        <div className="item-meta">
          Council incomplete — {render.failedRoles.join(', ')} did not answer. Read the
          draft with that in mind.
        </div>
      )}

      {!editing && (
        <div className="cert-preview">
          {draft.length === 0
            ? 'The council proposed no medicines. Edit & approve to add them yourself.'
            : draft.map((it, i) => `${i + 1}. ${itemLine(it)}`).join('\n')}
          {render.advice ? `\n\nAdvice: ${render.advice}` : ''}
          {render.followUp ? `\nFollow-up: ${render.followUp}` : ''}
        </div>
      )}

      {editing && (
        <div className="rx-editor">
          {items.map((it, i) => (
            <div key={i} className="rx-row">
              <input
                className="rx-input rx-input-name"
                placeholder="Drug name"
                value={it.name}
                onChange={(e) => setItem(i, { name: e.target.value })}
              />
              <input
                className="rx-input"
                placeholder="Dose"
                value={it.dose ?? ''}
                onChange={(e) => setItem(i, { dose: e.target.value })}
              />
              <input
                className="rx-input"
                placeholder="Frequency"
                value={it.frequency ?? ''}
                onChange={(e) => setItem(i, { frequency: e.target.value })}
              />
              <input
                className="rx-input rx-input-days"
                type="number"
                min={1}
                max={365}
                placeholder="Days"
                value={it.durationDays ?? ''}
                onChange={(e) =>
                  setItem(i, {
                    durationDays: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
              />
              <input
                className="rx-input"
                placeholder="Instructions"
                value={it.instructions ?? ''}
                onChange={(e) => setItem(i, { instructions: e.target.value })}
              />
              <button
                type="button"
                className="rx-drop"
                aria-label={`Remove ${it.name || 'this row'}`}
                onClick={() => setItems((list) => list.filter((_, n) => n !== i))}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setItems((list) => [...list, { name: '' }])}
          >
            Add a medicine
          </button>
        </div>
      )}

      <input
        className="rx-comment"
        placeholder="Add a comment (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />

      <div className="rx-actions">
        {!editing && (
          <>
            <button
              className="btn btn-success btn-sm"
              disabled={busy || blockers.length > 0}
              onClick={() => onApprove(comment || undefined)}
            >
              Approve &amp; sign
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => {
                setItems(draft.length > 0 ? draft : [{ name: '' }])
                setEditing(true)
              }}
            >
              Edit &amp; approve
            </button>
          </>
        )}
        {editing && (
          <>
            <button
              className="btn btn-success btn-sm"
              disabled={busy || items.every((it) => !it.name.trim())}
              onClick={() =>
                onApproveEdited(
                  items
                    .filter((it) => it.name.trim())
                    .map((it) => ({ ...it, name: it.name.trim() })),
                  comment || undefined,
                )
              }
            >
              Sign this version
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel edit
            </button>
          </>
        )}
        <button
          className="btn btn-danger btn-sm"
          disabled={busy}
          onClick={() => onReject(comment || undefined)}
        >
          Reject
        </button>
      </div>

      {blockers.length > 0 && (
        <div className="rx-blocked">
          Plain approval is blocked: {blockers.map((f) => f.message ?? f.role).join(' · ')}.
          Use <strong>Edit &amp; approve</strong> to sign a version you stand behind.
        </div>
      )}
    </div>
  )
}
