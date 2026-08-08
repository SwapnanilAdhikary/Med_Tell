import { useCallback, useEffect, useState } from 'react'
import { api, openAuthedFile } from '../api/client'
import type { MedicalDocument } from '../api/types'

function StatusPill({ status }: { status: MedicalDocument['status'] }) {
  const map: Record<string, { cls: string; label: string }> = {
    pending: { cls: 'pill-neutral', label: 'Processing' },
    'ai-reviewed': { cls: 'pill-info', label: 'AI reviewed' },
    'awaiting-doctor': { cls: 'pill-warning', label: 'Awaiting doctor' },
    approved: { cls: 'pill-success', label: 'Doctor verified' },
    rejected: { cls: 'pill-danger', label: 'Rejected' },
  }
  const m = map[status] ?? map.pending
  return <span className={`pill ${m.cls}`}>{m.label}</span>
}

function PatientName({ doc }: { doc: MedicalDocument }) {
  if (typeof doc.patient === 'string') return null
  return <span> · {doc.patient.name}</span>
}

export function Uploads() {
  const [docs, setDocs] = useState<MedicalDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setDocs(await api<MedicalDocument[]>('/api/documents'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const MAX_SIZE = 10 * 1024 * 1024 // 10 MB

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true)
    setError('')
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_SIZE) {
          setError(`${file.name} is too large (max 10 MB)`)
          return
        }
        const fd = new FormData()
        fd.append('file', file)
        const doc = await api<{ _id: string }>('/api/documents/upload', {
          method: 'POST',
          body: fd,
        })
        await api(`/api/documents/${doc._id}/analyze`, { method: 'POST', body: '{}' })
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="content">
      <div className="card">
        <div className="card-title">Upload a medical document</div>
        <div className="card-sub">
          Prescriptions, lab reports, scans, or discharge summaries. AI will extract findings
          and a doctor verifies the result.
        </div>
      </div>

      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFiles(e.dataTransfer.files)
        }}
        onClick={() => document.getElementById('upload-input')?.click()}
        style={{ cursor: 'pointer' }}
      >
        <input
          id="upload-input"
          type="file"
          multiple
          accept="image/*,application/pdf"
          style={{ display: 'none' }}
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="dropzone-title">{busy ? 'Analyzing…' : 'Drag & drop your report here'}</div>
        <div className="dropzone-sub">or click to browse · JPG, PNG, PDF · max 10MB</div>
        {error && <div style={{ color: 'var(--danger)', marginTop: 8, fontSize: 13 }}>{error}</div>}
      </div>

      <div className="item-list">
        {loading && <div className="loading">Loading reports…</div>}
        {!loading && docs.length === 0 && (
          <div className="empty-state">
            <div className="empty-title">No reports yet</div>
            <div>Upload your first medical document to get an AI analysis.</div>
          </div>
        )}
        {docs.map((doc) => (
          <div key={doc._id} className="item">
            <div style={{ fontSize: 22, flex: 'none' }}>🩺</div>
            <div className="item-main">
              <div className="item-title">
                {doc.filename}
                <PatientName doc={doc} />
              </div>
              <div style={{ marginTop: 6 }}>
                <StatusPill status={doc.status} />
              </div>
              {doc.aiFindings && (
                <div className="item-desc">
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>AI summary</div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{doc.aiFindings.summary}</div>
                  {doc.aiFindings.confidence > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <span className="confidence">
                        confidence {(doc.aiFindings.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  )}
                  {doc.aiFindings.abnormalFindings.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontWeight: 600, color: 'var(--warning)' }}>Abnormal findings</div>
                      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                        {doc.aiFindings.abnormalFindings.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {doc.aiFindings.recommendations.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontWeight: 600 }}>Recommendations</div>
                      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                        {doc.aiFindings.recommendations.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-3)' }}>
                    {doc.aiFindings.disclaimer}
                  </div>
                </div>
              )}
              {doc.doctorReview && (
                <div className="item-desc">
                  <span style={{ fontWeight: 600 }}>Doctor review:</span>{' '}
                  {doc.doctorReview.comment || (doc.doctorReview.decision === 'approved' ? 'Verified' : 'Rejected')}
                </div>
              )}
            </div>
            <div className="item-actions">
              {/* A plain link can't send the bearer token, so fetch the file. */}
              <button
                className="btn btn-secondary btn-sm"
                onClick={() =>
                  openAuthedFile(`/api/documents/${doc._id}/file`).catch(() => {})
                }
              >
                View
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
