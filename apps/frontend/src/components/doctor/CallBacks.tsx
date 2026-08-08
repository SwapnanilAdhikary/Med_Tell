import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import { useAuth } from '../../store/auth'
import type { Appointment } from '../../api/types'

function idOf(ref: Appointment['doctor']): string | undefined {
  if (!ref) return undefined
  return typeof ref === 'string' ? ref : ref._id
}

export function CallBacks() {
  const { user } = useAuth()
  const [items, setItems] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')

  const matchedToMe = useCallback(
    (a: Appointment) =>
      Boolean(user?.doctorId) && idOf(a.suggestedDoctor) === user?.doctorId,
    [user?.doctorId],
  )

  const load = useCallback(async () => {
    try {
      const queue = await api<Appointment[]>('/api/appointments/queue')
      // Cases the AI routed to this doctor come first.
      setItems(
        [...queue].sort(
          (a, b) => Number(matchedToMe(b)) - Number(matchedToMe(a)),
        ),
      )
    } finally {
      setLoading(false)
    }
  }, [matchedToMe])

  useEffect(() => {
    load()
  }, [load])

  const assign = async (id: string) => {
    setBusyId(id)
    await api('/api/appointments/assign', { method: 'POST', body: JSON.stringify({ appointmentId: id }) })
    setBusyId('')
    load()
  }

  const complete = async (id: string) => {
    const notes = window.prompt('Consultation notes (optional):') ?? ''
    setBusyId(id)
    await api('/api/appointments/complete', {
      method: 'POST',
      body: JSON.stringify({ appointmentId: id, consultNotes: notes }),
    })
    setBusyId('')
    load()
  }

  const name = (a: Appointment) => (typeof a.patient === 'object' ? a.patient.name : 'Patient')
  const phone = (a: Appointment) => a.callBackJob?.bestContactNumber ?? '—'

  return (
    <div className="content">
      <div className="card">
        <div className="card-title">Pending call-backs</div>
        <div className="card-sub">
          Booked via the AI agent (voice or chat). Review the AI notes, call the patient, then
          mark complete.
        </div>
      </div>

      <div className="item-list">
        {loading && <div className="loading">Loading…</div>}
        {!loading && items.length === 0 && (
          <div className="empty-state">
            <div className="empty-title">Queue is clear</div>
            <div>New consultations booked through the AI will appear here.</div>
          </div>
        )}
        {items.map((a) => (
          <div key={a._id} className="item">
            <div style={{ fontSize: 22, flex: 'none' }}>📞</div>
            <div className="item-main">
              <div className="item-title">
                {name(a)}
                {matchedToMe(a) && (
                  <span className="pill pill-info" style={{ marginLeft: 8 }}>
                    Matched to you
                  </span>
                )}
                {a.aiNotes?.urgency && (
                  <span
                    className={`pill ${
                      a.aiNotes.urgency === 'emergency' ||
                      a.aiNotes.urgency === 'urgent'
                        ? 'pill-danger'
                        : 'pill-neutral'
                    }`}
                    style={{ marginLeft: 8 }}
                  >
                    {a.aiNotes.urgency}
                  </span>
                )}
              </div>
              <div className="item-meta">
                Call-back number: {phone(a)}
                {a.callBackJob?.preferredWindow ? ` · Preferred: ${a.callBackJob.preferredWindow}` : ''}
                {a.suggestedSpecialty ? ` · Suggested: ${a.suggestedSpecialty}` : ''}
              </div>
              {a.reason && <div className="item-desc">Reason: {a.reason}</div>}
              {a.aiNotes?.summary && (
                <div className="item-desc">
                  <span style={{ fontWeight: 600 }}>AI visit notes:</span> {a.aiNotes.summary}
                </div>
              )}
              {a.aiNotes?.symptoms && a.aiNotes.symptoms.length > 0 && (
                <div className="item-desc">
                  <span style={{ fontWeight: 600 }}>Symptoms:</span>{' '}
                  {a.aiNotes.symptoms.join(', ')}
                </div>
              )}
              <div className="item-meta">
                Requested {new Date(a.createdAt).toLocaleString()}
              </div>
            </div>
            <div className="item-actions">
              {a.status === 'requested' && (
                <button className="btn btn-secondary btn-sm" disabled={busyId === a._id} onClick={() => assign(a._id)}>
                  Assign to me
                </button>
              )}
              {(a.status === 'assigned' || a.status === 'requested') && (
                <button className="btn btn-success btn-sm" disabled={busyId === a._id} onClick={() => complete(a._id)}>
                  Complete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
