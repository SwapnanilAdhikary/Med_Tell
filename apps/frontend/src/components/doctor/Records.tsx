import { useCallback, useEffect, useState } from 'react'
import { api, openAuthedFile } from '../../api/client'
import type { CallSession, MedicalDocument } from '../../api/types'

function PatientName({ v }: { v: { _id: string; name: string } | string }) {
  if (typeof v === 'string') return <span>—</span>
  return <span>{v.name}</span>
}

export function Records() {
  const [calls, setCalls] = useState<CallSession[]>([])
  const [docs, setDocs] = useState<MedicalDocument[]>([])

  const load = useCallback(async () => {
    const [c, d] = await Promise.all([
      api<CallSession[]>('/api/calls/all'),
      api<MedicalDocument[]>('/api/documents/all'),
    ])
    setCalls(c)
    setDocs(d)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="content">
      <div className="card">
        <div className="card-title">Recent AI call transcripts</div>
        <div className="card-sub">Full phone/browser call history with AI summaries.</div>
        <div className="item-list" style={{ marginTop: 12 }}>
          {calls.length === 0 && <div className="empty-state">No calls recorded</div>}
          {calls.map((c) => (
            <div key={c._id} className="item">
              <div style={{ fontSize: 20, flex: 'none' }}>📞</div>
              <div className="item-main">
                <div className="item-title">
                  <PatientName v={c.patient ?? '—'} /> · {c.phoneNumber ?? 'web'}
                </div>
                {c.summary && (
                  <>
                    <div className="item-desc">
                      <span style={{ fontWeight: 600 }}>Summary:</span>{' '}
                      {String(c.summary.summary ?? '')}
                    </div>
                    <div className="item-meta">
                      {[
                        c.summary.urgency && `Urgency: ${String(c.summary.urgency)}`,
                        c.summary.suggestedSpecialty &&
                          `Suggested: ${String(c.summary.suggestedSpecialty)}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </>
                )}
                {c.transcriptText && (
                  <details className="transcript">
                    <summary>Full transcript</summary>
                    <pre>{c.transcriptText}</pre>
                  </details>
                )}
                <div className="item-meta">{new Date(c.createdAt).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title">Documents awaiting review</div>
        <div className="card-sub">AI-analyzed medical documents queued for a doctor.</div>
        <div className="item-list" style={{ marginTop: 12 }}>
          {docs.length === 0 && <div className="empty-state">No documents in review</div>}
          {docs.map((d) => (
            <div key={d._id} className="item">
              <div style={{ fontSize: 20, flex: 'none' }}>🩺</div>
              <div className="item-main">
                <div className="item-title">
                  {d.filename} · <PatientName v={d.patient as never} />
                </div>                <div className="item-meta">Status: {d.status}</div>
                {d.aiFindings?.summary && (
                  <div className="item-desc">{d.aiFindings.summary}</div>
                )}
              </div>
              <div className="item-actions">
                {/* A plain link can't send the bearer token, so fetch the file. */}
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() =>
                    openAuthedFile(`/api/documents/${d._id}/file`).catch(() => {})
                  }
                >
                  View
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
