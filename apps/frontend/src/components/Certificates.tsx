import { useCallback, useEffect, useState } from 'react'
import { api, openAuthedFile } from '../api/client'
import type { Certificate } from '../api/types'

const TYPE_LABEL: Record<string, string> = {
  'sick-leave': 'Sick leave',
  fitness: 'Fitness',
  medical: 'Medical',
  insurance: 'Insurance support',
}

function StatusPill({ status }: { status: Certificate['status'] }) {
  const map: Record<string, { cls: string; label: string }> = {
    draft: { cls: 'pill-neutral', label: 'Draft' },
    'awaiting-doctor': { cls: 'pill-warning', label: 'Awaiting doctor' },
    issued: { cls: 'pill-success', label: 'Issued' },
    rejected: { cls: 'pill-danger', label: 'Rejected' },
  }
  const m = map[status] ?? map.draft
  return <span className={`pill ${m.cls}`}>{m.label}</span>
}

export function Certificates() {
  const [items, setItems] = useState<Certificate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setItems(await api<Certificate[]>('/api/certificates'))
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
        <div className="card-title">Medical certificates</div>
        <div className="card-sub">
          AI drafts the certificate; a licensed doctor verifies and signs it before you can
          download it.
        </div>
      </div>

      {error && <div className="auth-error">{error}</div>}

      <div className="item-list">
        {loading && <div className="loading">Loading…</div>}
        {!loading && items.length === 0 && (
          <div className="empty-state">
            <div className="empty-title">No certificates yet</div>
            <div>Ask the AI assistant for a sick leave, fitness, or insurance certificate.</div>
          </div>
        )}
        {items.map((c) => (
          <div key={c._id} className="item">
            <div style={{ fontSize: 22, flex: 'none' }}>📄</div>
            <div className="item-main">
              <div className="item-title">{TYPE_LABEL[c.type] ?? c.type}</div>
              <div style={{ marginTop: 6 }}>
                <StatusPill status={c.status} />
              </div>
              {c.draftContent?.title && <div className="item-desc">{c.draftContent.title}</div>}
              {c.draftContent?.body && (
                <div className="cert-preview">{c.draftContent.body}</div>
              )}
              {c.signedBy && (
                <div className="item-meta" style={{ marginTop: 6, color: 'var(--success)' }}>
                  Signed by {c.signedBy}
                  {c.issuedAt ? ` · ${new Date(c.issuedAt).toLocaleDateString()}` : ''}
                </div>
              )}
              {c.rejectReason && (
                <div className="item-meta" style={{ color: 'var(--danger)' }}>
                  Rejected: {c.rejectReason}
                </div>
              )}
            </div>
            {c.status === 'issued' && (
              <div className="item-actions">
                {/* A plain link can't send the bearer token, so fetch the PDF. */}
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() =>
                    openAuthedFile(`/api/certificates/${c._id}/pdf`).catch((e) =>
                      setError(e instanceof Error ? e.message : String(e)),
                    )
                  }
                >
                  Download PDF
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
