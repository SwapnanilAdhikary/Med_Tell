import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import type { FieldReport } from '../../api/types'
import { ageLabel, subjectName } from './labels'
import { GeoChip, StatusPill, UrgencyPill } from './pills'

function ReportRow({ report }: { report: FieldReport }) {
  const e = report.extraction
  return (
    <li className="item">
      <div className="item-main">
        <div className="item-title">
          {subjectName(report)}
          {e.ageMonths != null && <span className="item-meta"> · {ageLabel(e.ageMonths)}</span>}
        </div>
        <div className="item-meta">
          {new Date(report.createdAt).toLocaleString()} ·{' '}
          {report.channel === 'voice' ? 'Phoned in' : 'Filed on the web'}
          {report.location.village ? ` · ${report.location.village}` : ''}
        </div>
        {e.symptoms.length > 0 && <div className="item-desc">{e.symptoms.join(', ')}</div>}
        <div className="status-timeline">
          <StatusPill status={report.status} />
          <UrgencyPill urgency={e.urgency} />
          <GeoChip location={report.location} />
          {report.matchedDoctor && (
            <span className="pill pill-primary">
              Dr. {report.matchedDoctor.name} · {report.matchedDoctor.specialty}
            </span>
          )}
        </div>
      </div>
      <div className="item-actions">
        <Link className="btn btn-secondary btn-sm" to={`/field/reports/${report._id}`}>
          Open
        </Link>
      </div>
    </li>
  )
}

export function MyReports() {
  const [reports, setReports] = useState<FieldReport[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setReports(await api<FieldReport[]>('/api/field-reports/mine'))
      setError('')
    } catch (err) {
      // A missing catch here is what leaves the sibling screens spinning forever.
      setError(err instanceof Error ? err.message : 'Could not load your reports')
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [load])

  return (
    <div className="content">
      <div className="card">
        <h2 className="card-title">My reports</h2>
        <div className="card-sub">
          Everything you have filed. This list refreshes on its own.
        </div>
      </div>

      {error && (
        <div className="auth-error" role="alert" style={{ marginTop: 16 }}>
          {error}{' '}
          <button type="button" className="btn btn-secondary btn-sm" onClick={load}>
            Try again
          </button>
        </div>
      )}

      {!reports && !error && (
        <div className="loading" role="status">
          Loading your reports…
        </div>
      )}

      {reports?.length === 0 && (
        <div className="empty-state">
          <div className="empty-title">No reports yet</div>
          <div>File your first household report and it will appear here.</div>
          <Link className="btn btn-primary" style={{ marginTop: 16 }} to="/field">
            New report
          </Link>
        </div>
      )}

      {reports && reports.length > 0 && (
        <ul className="item-list" style={{ marginTop: 16 }}>
          {reports.map((r) => (
            <ReportRow key={r._id} report={r} />
          ))}
        </ul>
      )}
    </div>
  )
}
