import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { Appointment, CallSession } from '../../api/types'

interface Overview {
  patients: number
  doctors: number
  appointments: number
  pendingAppointments: number
  calls: number
  documentsPending: number
  certificatesPending: number
  verificationPending: number
  issuedCertificates: number
  recentAppointments: Appointment[]
  recentCalls: CallSession[]
}

export function DoctorOverview() {
  const [data, setData] = useState<Overview | null>(null)

  const load = useCallback(async () => {
    setData(await api<Overview>('/api/admin/overview'))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (!data) return <div className="loading">Loading…</div>

  const stats = [
    { label: 'Patients', value: data.patients },
    { label: 'Pending call-backs', value: data.pendingAppointments },
    { label: 'Verification queue', value: data.verificationPending },
    { label: 'Docs awaiting review', value: data.documentsPending },
    { label: 'Certs awaiting review', value: data.certificatesPending },
    { label: 'Calls handled', value: data.calls },
    { label: 'Certs issued', value: data.issuedCertificates },
  ]

  return (
    <div className="content">
      <div className="grid grid-4">
        {stats.map((s) => (
          <div key={s.label} className="stat">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-title">Recent call-back requests</div>
        {data.recentAppointments.length === 0 && (
          <div className="empty-state">No appointments yet</div>
        )}
        <div className="item-list" style={{ marginTop: 12 }}>
          {data.recentAppointments.slice(0, 5).map((a) => (
            <div key={a._id} className="item">
              <div style={{ fontSize: 20, flex: 'none' }}>📅</div>
              <div className="item-main">
                <div className="item-title">
                  {typeof a.patient === 'object' ? a.patient.name : 'Patient'} · {a.status}
                </div>
                {a.reason && <div className="item-desc">{a.reason}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title">Recent AI calls</div>
        {data.recentCalls.length === 0 && (
          <div className="empty-state">No calls recorded yet</div>
        )}
        <div className="item-list" style={{ marginTop: 12 }}>
          {data.recentCalls.slice(0, 5).map((c) => (
            <div key={c._id} className="item">
              <div style={{ fontSize: 20, flex: 'none' }}>📞</div>
              <div className="item-main">
                <div className="item-title">
                  {typeof c.patient === 'object' ? c.patient.name : c.phoneNumber ?? 'Call'} ·{' '}
                  {String(c.summary?.recommendedAction ?? c.status)}
                </div>
                {typeof c.summary?.summary === 'string' && (
                  <div className="item-desc">{c.summary.summary}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
