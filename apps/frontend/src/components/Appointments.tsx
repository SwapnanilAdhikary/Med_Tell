import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Appointment, DoctorRef } from '../api/types'

function StatusPill({ status }: { status: Appointment['status'] }) {
  const map: Record<string, { cls: string; label: string }> = {
    requested: { cls: 'pill-warning', label: 'Requested' },
    assigned: { cls: 'pill-info', label: 'Doctor assigned' },
    completed: { cls: 'pill-success', label: 'Completed' },
    cancelled: { cls: 'pill-neutral', label: 'Cancelled' },
  }
  const m = map[status] ?? map.requested
  return <span className={`pill ${m.cls}`}>{m.label}</span>
}

/** The doctor who took the case, or the specialty match if nobody has yet. */
function doctorRefOf(a: Appointment): DoctorRef | null {
  for (const ref of [a.doctor, a.suggestedDoctor]) {
    if (ref && typeof ref !== 'string') return ref
  }
  return null
}

function DoctorCard({ a }: { a: Appointment }) {
  const doctor = doctorRefOf(a)
  if (!doctor) {
    return (
      <div className="doctor-card doctor-card-pending">
        Matching you with a doctor…
        {a.suggestedSpecialty ? ` (${a.suggestedSpecialty})` : ''}
      </div>
    )
  }
  const confirmed = Boolean(a.doctor && typeof a.doctor !== 'string')
  return (
    <div className="doctor-card">
      <div className="doctor-card-avatar">
        {doctor.name.trim().charAt(0).toUpperCase()}
      </div>
      <div>
        {/* `title` is a qualification (MBBS, MD), so "Dr." is separate. */}
        <div className="doctor-card-name">
          Dr. {doctor.name}
          {doctor.title ? `, ${doctor.title}` : ''}
        </div>
        <div className="doctor-card-meta">
          {doctor.specialty} ·{' '}
          {confirmed ? 'has taken your case' : 'matched, awaiting confirmation'}
        </div>
      </div>
    </div>
  )
}

export function Appointments() {
  const [items, setItems] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setItems(await api<Appointment[]>('/api/appointments'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="content">
      <div className="card">
        <div className="card-title">Appointments & call-backs</div>
        <div className="card-sub">
          Booked through chat or a phone call. A doctor calls you back — no need to wait on a
          line.
        </div>
      </div>

      <div className="item-list">
        {loading && <div className="loading">Loading…</div>}
        {!loading && items.length === 0 && (
          <div className="empty-state">
            <div className="empty-title">No appointments yet</div>
            <div>Message the AI assistant to book an asynchronous consultation.</div>
          </div>
        )}
        {items.map((a) => (
          <div key={a._id} className="item">
            <div style={{ fontSize: 22, flex: 'none' }}>📅</div>
            <div className="item-main">
              <DoctorCard a={a} />
              <div style={{ marginTop: 6 }}>
                <StatusPill status={a.status} />
              </div>
              {a.reason && <div className="item-desc">Reason: {a.reason}</div>}
              {a.aiNotes?.symptoms?.length ? (
                <div className="item-desc">
                  Symptoms: {a.aiNotes.symptoms.join(', ')}
                </div>
              ) : null}
              {a.aiNotes?.urgency && (
                <div className="item-desc">Urgency: {a.aiNotes.urgency}</div>
              )}
              {a.callBackJob?.preferredWindow && (
                <div className="item-desc">Preferred time: {a.callBackJob.preferredWindow}</div>
              )}
              {a.aiNotes?.summary && (
                <div className="item-desc">
                  <span style={{ fontWeight: 600 }}>AI notes:</span> {a.aiNotes.summary}
                </div>
              )}
              {a.callBackJob?.consultNotes && (
                <div className="item-desc">
                  <span style={{ fontWeight: 600 }}>Doctor notes:</span> {a.callBackJob.consultNotes}
                </div>
              )}
              <div className="item-meta">
                Requested {new Date(a.createdAt).toLocaleString()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
