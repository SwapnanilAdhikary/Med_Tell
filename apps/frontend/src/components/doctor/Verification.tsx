import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { VerificationTask } from '../../api/types'
import { PrescriptionTask } from './PrescriptionTask'
import type { RxRender } from './PrescriptionTask'
import { refName } from '../../names'

interface TaskWithRef extends VerificationTask {
  resolved?: {
    filename?: string
    aiFindings?: {
      docType: string
      summary: string
      abnormalFindings: string[]
      recommendations: string[]
      confidence: number
      disclaimer: string
    }
    draftContent?: { title?: string; body?: string }
    summary?: { summary?: string; symptoms?: string[]; recommendedAction?: string }
    type?: string
  }
}

const TASK_LABEL: Record<string, string> = {
  document: 'Medical document',
  certificate: 'Certificate',
  prescription: 'AI-drafted prescription',
  'call-note': 'AI call notes',
  appointment: 'Appointment',
}

// A record, not a nested ternary: a new task type used to fall through to '📞'
// and the doctor saw an unlabelled phone card with no drug list.
const TASK_ICON: Record<string, string> = {
  document: '🩺',
  certificate: '📄',
  prescription: '💊',
  'call-note': '📞',
  appointment: '📅',
}

export function Verification() {
  const [items, setItems] = useState<TaskWithRef[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [comment, setComment] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      const tasks = await api<VerificationTask[]>('/api/verification/queue')
      setItems(tasks as TaskWithRef[])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const post = async (id: string, path: string, body: Record<string, unknown>) => {
    setBusyId(id)
    try {
      await api(`/api/verification/${id}/${path}`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      await load()
    } finally {
      setBusyId('')
    }
  }

  const decide = (id: string, decision: 'approve' | 'reject') =>
    post(id, decision, { comment: comment[id] || undefined })

  const resolveTask = (t: TaskWithRef): TaskWithRef['resolved'] => {
    if (t.taskType === 'document') {
      const f = (t.aiOutput ?? {}) as {
        docType?: string
        summary?: string
        abnormalFindings?: string[]
        recommendations?: string[]
        confidence?: number
        disclaimer?: string
      }
      return {
        aiFindings: {
          docType: f.docType ?? 'document',
          summary: f.summary ?? '',
          abnormalFindings: f.abnormalFindings ?? [],
          recommendations: f.recommendations ?? [],
          confidence: f.confidence ?? 0,
          disclaimer: f.disclaimer ?? '',
        },
      }
    }
    if (t.taskType === 'certificate') {
      const f = (t.aiOutput ?? {}) as { type?: string; draft?: { title?: string; body?: string } }
      return { type: f.type, draftContent: f.draft }
    }
    if (t.taskType === 'call-note') {
      const f = (t.aiOutput ?? {}) as { summary?: { summary?: string; symptoms?: string[]; recommendedAction?: string } }
      return { summary: f.summary }
    }
    return undefined
  }

  const name = (t: TaskWithRef) => refName(t.patient)

  return (
    <div className="content">
      <div className="card">
        <div className="card-title">Doctor verification queue</div>
        <div className="card-sub">
          Every AI output — document diagnosis, certificate, or call notes — must be reviewed by
          a doctor before it is shared with the patient.
        </div>
      </div>

      <div className="item-list">
        {loading && <div className="loading">Loading…</div>}
        {!loading && items.length === 0 && (
          <div className="empty-state">
            <div className="empty-title">Nothing pending</div>
            <div>New AI drafts awaiting your review will appear here.</div>
          </div>
        )}
        {items.map((t) => {
          const r = resolveTask(t)
          const icon = (
            <div style={{ fontSize: 22, flex: 'none' }}>{TASK_ICON[t.taskType] ?? '📋'}</div>
          )

          if (t.taskType === 'prescription') {
            return (
              <div key={t._id} className="item">
                {icon}
                <PrescriptionTask
                  render={(t.aiOutput ?? {}) as RxRender}
                  busy={busyId === t._id}
                  onApprove={(c) => post(t._id, 'approve', { comment: c })}
                  onApproveEdited={(rxItems, c) =>
                    post(t._id, 'approve-edited', { items: rxItems, comment: c })
                  }
                  onReject={(c) => post(t._id, 'reject', { comment: c })}
                />
              </div>
            )
          }

          return (
            <div key={t._id} className="item">
              {icon}
              <div className="item-main">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span className="item-title">{TASK_LABEL[t.taskType]}</span>
                  <span className="pill pill-warning">pending</span>
                </div>
                <div className="item-meta">Patient: {name(t)}</div>
                {r?.aiFindings && (
                  <div className="item-desc">
                    {r.aiFindings.summary && (
                      <div style={{ whiteSpace: 'pre-wrap' }}>{r.aiFindings.summary}</div>
                    )}
                    {r.aiFindings.abnormalFindings.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        <span style={{ fontWeight: 600, color: 'var(--warning)' }}>
                          Abnormal: {r.aiFindings.abnormalFindings.join('; ')}
                        </span>
                      </div>
                    )}
                    {r.aiFindings.confidence > 0 && (
                      <div style={{ marginTop: 6 }}>
                        <span className="confidence">
                          confidence {(r.aiFindings.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    )}
                  </div>
                )}
                {r?.draftContent && (
                  <div className="cert-preview">
                    {r.draftContent.title ? `# ${r.draftContent.title}\n` : ''}
                    {r.draftContent.body}
                  </div>
                )}
                {r?.summary?.summary && (
                  <div className="item-desc">
                    <span style={{ fontWeight: 600 }}>AI summary:</span> {r.summary.summary}
                  </div>
                )}
                {r?.summary?.symptoms && r.summary.symptoms.length > 0 && (
                  <div className="item-desc">
                    <span style={{ fontWeight: 600 }}>Symptoms:</span>{' '}
                    {r.summary.symptoms.join(', ')}
                  </div>
                )}
                {r?.summary?.recommendedAction && (
                  <div className="item-desc">
                    <span style={{ fontWeight: 600 }}>Recommended action:</span>{' '}
                    {r.summary.recommendedAction}
                  </div>
                )}
                <input
                  style={{
                    marginTop: 10,
                    width: '100%',
                    padding: '8px 10px',
                    border: '1px solid var(--border-2)',
                    borderRadius: 8,
                    fontFamily: 'inherit',
                    fontSize: 13,
                  }}
                  placeholder="Add a comment (optional)"
                  value={comment[t._id] ?? ''}
                  onChange={(e) => setComment((c) => ({ ...c, [t._id]: e.target.value }))}
                />
              </div>
              <div className="item-actions" style={{ flexDirection: 'column' }}>
                <button className="btn btn-success btn-sm" disabled={busyId === t._id} onClick={() => decide(t._id, 'approve')}>
                  Approve & sign
                </button>
                <button className="btn btn-danger btn-sm" disabled={busyId === t._id} onClick={() => decide(t._id, 'reject')}>
                  Reject
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
