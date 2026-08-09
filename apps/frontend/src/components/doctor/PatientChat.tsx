import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../../api/client'
import type { ChatMessage } from '../../api/types'

interface Thread {
  conversationId: string
  language: string
  patient?: { _id: string; name: string; login: string; reachable: boolean }
  handoffAt?: string | null
  messages: ChatMessage[]
}

export function PatientChat() {
  const { patientId } = useParams<{ patientId: string }>()
  const [thread, setThread] = useState<Thread | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const end = useRef<HTMLDivElement>(null)
  // Server-driven: a local flag reset to false on every reload and told the
  // doctor the assistant was live when it was not.
  const held = !!thread?.handoffAt

  const load = useCallback(async () => {
    if (!patientId) return
    try {
      const data = await api<Thread>(`/api/chat/doctor/${patientId}`)
      setThread(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this conversation')
    }
  }, [patientId])

  useEffect(() => {
    load()
    // The patient may reply while this is open, and there are no sockets.
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [thread])

  const act = async (path: string, body?: Record<string, unknown>) => {
    if (!patientId) return
    setBusy(true)
    setError('')
    try {
      await api(`/api/chat/doctor/${patientId}/${path}`, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not go through')
    } finally {
      setBusy(false)
    }
  }

  const send = async () => {
    const message = text.trim()
    if (!message) return
    setText('')
    await act('message', { message })
  }

  if (error && !thread) {
    return (
      <div className="content">
        <div className="auth-error" role="alert">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="content">
      <div className="card">
        <div className="card-title">
          {thread?.patient ? `Chat with ${thread.patient.name}` : 'Patient conversation'}
        </div>
        <div className="card-sub">
          {thread?.patient?.login ? (
            <>
              Signs in as <span className="mono">{thread.patient.login}</span>. Anything you
              write reaches them as coming from you, and the assistant can see it too.
            </>
          ) : (
            'Anything you write here reaches the patient as coming from you, and the assistant can see it too.'
          )}
        </div>
        {thread?.patient && !thread.patient.reachable && (
          <div className="rx-blocked">
            This person has no login - they were reported by a health worker and have no
            phone on file. Nothing written here will ever be read. Tell the worker instead.
          </div>
        )}
        <div className="rx-actions">
          <button
            className="btn btn-primary btn-sm"
            disabled={busy || held}
            onClick={() => void act('handoff')}
          >
            Take over this chat
          </button>
          <button
            className="btn btn-secondary btn-sm"
            disabled={busy || !held}
            onClick={() => void act('release')}
          >
            Hand back to the assistant
          </button>
          <Link className="btn btn-secondary btn-sm" to="/doctor/callbacks">
            Back to call-backs
          </Link>
        </div>
        {held && (
          <div className="item-meta" style={{ marginTop: 8 }}>
            The assistant will not answer this patient until you hand it back.
          </div>
        )}
        {error && <div className="form-error">{error}</div>}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="thread">
          {(thread?.messages ?? []).length === 0 && (
            <div className="empty-state">Nothing in this conversation yet</div>
          )}
          {(thread?.messages ?? []).map((m) => (
            <div
              key={m._id}
              className={`thread-msg ${m.role === 'user' ? 'thread-patient' : 'thread-ai'}`}
            >
              <div className="thread-who">
                {m.role === 'user'
                  ? 'Patient'
                  : m.metadata?.author === 'doctor'
                    ? `Dr. ${m.metadata.doctorName ?? 'you'}`
                    : 'Assistant'}
              </div>
              <div>{m.content}</div>
            </div>
          ))}
          <div ref={end} />
        </div>

        <div className="thread-compose">
          <textarea
            className="note-area"
            rows={3}
            placeholder="Write to the patient…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <button
            className="btn btn-primary"
            disabled={busy || !text.trim()}
            onClick={() => void send()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
