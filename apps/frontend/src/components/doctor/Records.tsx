import { useCallback, useEffect, useState } from 'react'
import { api, openAuthedFile } from '../../api/client'
import type { CallSession, MedicalDocument, PrescriptionItem } from '../../api/types'
import { refName } from '../../names'

/** The doctor's own signing record, so draftItems is included on purpose. */
interface SignedRx {
  _id: string
  patient: { _id: string; name: string } | string | null
  items?: PrescriptionItem[]
  draftItems?: PrescriptionItem[]
  signedBy?: string
  issuedAt?: string
  consultMode?: string
}

function itemLine(item: PrescriptionItem): string {
  const tokens = [
    item.dose,
    item.frequency,
    item.durationDays != null ? `${item.durationDays} days` : '',
    item.instructions,
  ].filter(Boolean)
  return tokens.length > 0 ? `${item.name} · ${tokens.join(' · ')}` : item.name
}

function names(items?: PrescriptionItem[]): string {
  return (items ?? []).map((i) => i.name).join(', ')
}

export function Records() {
  const [calls, setCalls] = useState<CallSession[]>([])
  const [docs, setDocs] = useState<MedicalDocument[]>([])
  const [signed, setSigned] = useState<SignedRx[]>([])

  const load = useCallback(async () => {
    const [c, d, s] = await Promise.all([
      api<CallSession[]>('/api/calls/all'),
      api<MedicalDocument[]>('/api/documents/all'),
      api<SignedRx[]>('/api/prescriptions/signed'),
    ])
    setCalls(c)
    setDocs(d)
    setSigned(s)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="content">
      <div className="card">
        <div className="card-title">Prescriptions you signed</div>
        <div className="card-sub">
          Your record of what you put your name to, and where it differed from the AI draft.
        </div>
        <div className="item-list" style={{ marginTop: 12 }}>
          {signed.length === 0 && (
            <div className="empty-state">You have not signed any prescriptions yet</div>
          )}
          {signed.map((rx) => {
            const changed = names(rx.items) !== names(rx.draftItems)
            return (
              <div key={rx._id} className="item">
                <div style={{ fontSize: 20, flex: 'none' }}>💊</div>
                <div className="item-main">
                  <div className="rx-head">
                    <span className="item-title">{refName(rx.patient, '—')}</span>
                    <span className={`pill ${changed ? 'pill-info' : 'pill-neutral'}`}>
                      {changed ? 'Edited the draft' : 'Signed as drafted'}
                    </span>
                    {rx.issuedAt && (
                      <span className="item-meta">
                        {new Date(rx.issuedAt).toLocaleString('en-IN')}
                      </span>
                    )}
                  </div>
                  <ol className="rx-read">
                    {(rx.items ?? []).map((item, i) => (
                      <li key={`${item.name}-${i}`}>{itemLine(item)}</li>
                    ))}
                  </ol>
                  {changed && (
                    <div className="item-meta">
                      AI had proposed: {names(rx.draftItems) || 'nothing'}
                    </div>
                  )}
                  {rx.signedBy && <div className="item-meta">{rx.signedBy}</div>}
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ marginTop: 8 }}
                    onClick={() => void openAuthedFile(`/api/prescriptions/${rx._id}/pdf`)}
                  >
                    Open the signed PDF
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">Recent AI call transcripts</div>
        <div className="card-sub">Full phone/browser call history with AI summaries.</div>
        <div className="item-list" style={{ marginTop: 12 }}>
          {calls.length === 0 && <div className="empty-state">No calls recorded</div>}
          {calls.map((c) => (
            <div key={c._id} className="item">
              <div style={{ fontSize: 20, flex: 'none' }}>📞</div>
              <div className="item-main">
                <div className="item-title">
                  {refName(c.patient, '—')} · {c.phoneNumber ?? 'web'}
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
                  {d.filename} · {refName(d.patient, '—')}
                </div>                <div className="item-meta">Status: {d.status}</div>
                {d.aiFindings?.summary && (
                  <div className="item-desc">{d.aiFindings.summary}</div>
                )}
              </div>
              
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
