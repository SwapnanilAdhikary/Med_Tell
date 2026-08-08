import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api/client'
import type { FieldNote } from '../../api/types'
import type { PickedPoint } from './CaptureSheet'

const SAVE_DEBOUNCE_MS = 800

function preview(note: FieldNote): string {
  const rest = note.body.split('\n').slice(1).join(' ').trim()
  return rest || 'No additional text'
}

export function NotesList() {
  const [notes, setNotes] = useState<FieldNote[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setNotes(await api<FieldNote[]>('/api/field-notes'))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your notes')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const togglePin = async (note: FieldNote) => {
    await api(`/api/field-notes/${note._id}`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned: !note.pinned }),
    })
    load()
  }

  return (
    <div className="content">
      <div className="card">
        <div className="notes-head">
          <div>
            <h2 className="card-title">Notes</h2>
            <div className="card-sub">
              Only you can see these. Nothing here is sent to a doctor.
            </div>
          </div>
          <Link className="btn btn-primary" to="/field/notes/new">
            New note
          </Link>
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

      {!notes && !error && (
        <div className="loading" role="status">
          Loading your notes…
        </div>
      )}

      {notes?.length === 0 && (
        <div className="empty-state">
          <div className="empty-title">No notes yet</div>
          <div>Jot down anything you need to remember for your next visit.</div>
        </div>
      )}

      {notes && notes.length > 0 && (
        <ul className="item-list" style={{ marginTop: 16 }}>
          {notes.map((note) => (
            <li className="item" key={note._id}>
              <div className="item-main">
                <div className="item-title">
                  {note.pinned && <span aria-label="Pinned">📌 </span>}
                  {note.title}
                </div>
                <div className="item-meta">
                  {new Date(note.updatedAt).toLocaleString()}
                  {note.village ? ` · ${note.village}` : ''}
                  {note.point ? ' · pinned to a place' : ''}
                </div>
                <div className="item-desc note-preview">{preview(note)}</div>
              </div>
              <div className="item-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => togglePin(note)}
                  aria-pressed={note.pinned}
                >
                  {note.pinned ? 'Unpin' : 'Pin'}
                </button>
                <Link className="btn btn-secondary btn-sm" to={`/field/notes/${note._id}`}>
                  Open
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * One textarea, autosaved. The first line becomes the title, the way a notes
 * app does it - no separate title field to fill in while standing in a doorway.
 */
export function NoteEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const point = (useLocation().state as { point?: PickedPoint } | null)?.point

  const [noteId, setNoteId] = useState<string | undefined>(
    id === 'new' ? undefined : id,
  )
  const [body, setBody] = useState('')
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!noteId) {
      area.current?.focus()
      return
    }
    api<FieldNote[]>('/api/field-notes')
      .then((all) => setBody(all.find((n) => n._id === noteId)?.body ?? ''))
      .catch(() => setError('Could not load this note'))
  }, [noteId])

  const persist = useCallback(
    async (text: string) => {
      setSaved('saving')
      try {
        if (noteId) {
          await api(`/api/field-notes/${noteId}`, {
            method: 'PATCH',
            body: JSON.stringify({ body: text }),
          })
        } else {
          const created = await api<FieldNote>('/api/field-notes', {
            method: 'POST',
            body: JSON.stringify({
              body: text,
              ...(point ? { geo: { lat: point.lat, lng: point.lng } } : {}),
            }),
          })
          setNoteId(created._id)
        }
        setSaved('saved')
      } catch (err) {
        setSaved('idle')
        setError(err instanceof Error ? err.message : 'Could not save')
      }
    },
    [noteId, point],
  )

  const onChange = (text: string) => {
    setBody(text)
    setSaved('idle')
    if (timer.current) clearTimeout(timer.current)
    if (!text.trim()) return
    timer.current = setTimeout(() => void persist(text), SAVE_DEBOUNCE_MS)
  }

  const remove = async () => {
    if (noteId) await api(`/api/field-notes/${noteId}`, { method: 'DELETE' })
    navigate('/field/notes')
  }

  return (
    <div className="content" style={{ maxWidth: 720 }}>
      <div className="card">
        <div className="notes-head">
          <div className="card-sub">
            {point
              ? `Pinned to ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`
              : 'Not pinned to a place'}
          </div>
          <span className="field-hint" role="status">
            {saved === 'saving' && 'Saving…'}
            {saved === 'saved' && 'Saved'}
          </span>
        </div>

        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}

        <label className="sr-only" htmlFor="note-body">
          Note
        </label>
        <textarea
          id="note-body"
          ref={area}
          className="note-area"
          value={body}
          onChange={(e) => onChange(e.target.value)}
          placeholder={'Rekha Bibi\nBP cuff is broken, bring the spare on Tuesday.'}
        />

        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <Link className="btn btn-secondary" to="/field/notes">
            Done
          </Link>
          <button type="button" className="btn btn-danger" onClick={remove}>
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
