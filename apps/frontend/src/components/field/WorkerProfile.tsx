import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { HealthWorker } from '../../api/types'

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  hi: 'हिन्दी',
  bn: 'বাংলা',
}

export function WorkerProfile() {
  const [worker, setWorker] = useState<HealthWorker | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<HealthWorker>('/api/health-workers/me')
      .then(setWorker)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load your profile'),
      )
  }, [])

  if (error) {
    return (
      <div className="content">
        <div className="auth-error" role="alert">
          {error}
        </div>
      </div>
    )
  }

  if (!worker) {
    return (
      <div className="loading" role="status">
        Loading your profile…
      </div>
    )
  }

  const rows: Array<[string, string]> = [
    ['Name', worker.name],
    ['Cadre', worker.cadre],
    ['Worker code', worker.workerCode ?? 'Not assigned'],
    ['Village', worker.village ?? 'Not assigned'],
    ['Block', worker.block ?? 'Not assigned'],
    ['District', worker.district ?? 'Not assigned'],
    ['State', worker.state ?? 'Not assigned'],
    [
      'Languages',
      worker.languages.length
        ? worker.languages.map((l) => LANGUAGE_NAMES[l] ?? l).join(', ')
        : 'Not recorded',
    ],
  ]

  return (
    <div className="content" style={{ maxWidth: 640 }}>
      <div className="card">
        <h2 className="card-title">Your worker profile</h2>
        <div className="card-sub">
          Your cadre and assigned area are set by your supervisor. Reports with no GPS are tagged to
          this area.
        </div>
        <dl className="detail-list">
          {rows.map(([label, value]) => (
            <div className="detail-row" key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {!worker.active && (
          <div className="auth-error" role="status" style={{ marginTop: 16 }}>
            This account is marked inactive. Contact your supervisor.
          </div>
        )}
      </div>
    </div>
  )
}
