import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { ChatAction, ChatMessage } from '../api/types'
import { startCall, stopCall, isCallConfigured, toggleMute } from '../api/call'
import { startRingtone, stopRingtone } from '../audio/ringtone'
import { CallModal } from './CallModal'

interface SendResult {
  reply: string
  actions: ChatAction[]
}

const QUICK_ACTIONS: Array<{ label: string; upload?: boolean }> = [
  { label: 'Book a consultation' },
  { label: 'Upload a report', upload: true },
  { label: 'Get a sick leave certificate' },
  { label: 'I have a headache' },
]

/**
 * Shows what the agent actually did. Tool results come from the backend, so
 * these cards reflect real records rather than the reply text.
 */
function ActionStrip({ actions }: { actions: ChatAction[] }) {
  const cards = actions
    .map((action) => {
      const r = action.result ?? {}
      if (r.error) {
        return {
          key: `${action.name}-error`,
          className: 'action-card action-card-error',
          body: <>That step didn&rsquo;t go through: {r.error}</>,
        }
      }
      switch (action.name) {
        case 'emergency':
          return {
            key: 'emergency',
            className: 'action-card chip-emergency',
            body: (
              <>
                <strong>Emergency</strong> — call{' '}
                {(r.emergencyNumbers ?? ['112']).join(' or ')} now, or go to the
                nearest hospital.
              </>
            ),
          }
        case 'book_consultation':
          return {
            key: `booked-${r.appointmentId}`,
            className: 'action-card',
            body: (
              <>
                <strong>Call-back requested.</strong>{' '}
                {r.suggestedDoctor
                  ? `Matched with Dr. ${r.suggestedDoctor.name} (${r.suggestedDoctor.specialty}).`
                  : 'A doctor will pick this up shortly.'}{' '}
                <Link to="/appointments">View consultations</Link>
              </>
            ),
          }
        case 'request_certificate':
          return {
            key: `cert-${r.certificateId}`,
            className: 'action-card',
            body: (
              <>
                <strong>{r.type ?? 'Certificate'} draft created.</strong> A
                doctor must verify it before download.{' '}
                <Link to="/certificates">View certificates</Link>
              </>
            ),
          }
        default:
          return null
      }
    })
    .filter(Boolean)

  if (cards.length === 0) return null
  return (
    <div className="action-strip">
      {cards.map((card) => (
        <div key={card!.key} className={card!.className}>
          {card!.body}
        </div>
      ))}
    </div>
  )
}

function useTyping(text: string, done: () => void) {
  const [shown, setShown] = useState('')
  useEffect(() => {
    if (!text) return
    let i = 0
    setShown('')
    const t = setInterval(() => {
      i += 3
      setShown(text.slice(0, i))
      if (i >= text.length) {
        clearInterval(t)
        done()
      }
    }, 20)
    return () => clearInterval(t)
  }, [text, done])
  return shown
}

function AiBubble({ text, onDone }: { text: string; onDone: () => void }) {
  const shown = useTyping(text, onDone)
  return (
    <div className="msg-bubble">
      <div className="msg-text">
        {shown}
        {shown.length < text.length ? '▍' : ''}
      </div>
    </div>
  )
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function TicksIcon() {
  return (
    <svg width="16" height="12" viewBox="0 0 18 12" fill="currentColor" aria-hidden="true">
      <path d="M7.9 10.3 1.2 3.6a.7.7 0 0 1 1-1l5.7 5.7L15.7.6a.7.7 0 0 1 1 1L7.9 10.3z" />
      <path d="M12.1 11.7l-3.3-3.3 1-1 3.3 3.3 5.5-5.5a.7.7 0 0 1 1 1l-6 6a.7.7 0 0 1-1.5-.5z" transform="translate(-4 -0.6)" />
    </svg>
  )
}

function CallIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z" />
    </svg>
  )
}

function EndCallIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z" />
    </svg>
  )
}

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [language, setLanguage] = useState('en')
  const [callState, setCallState] = useState<'idle' | 'starting' | 'active' | 'unavailable'>('idle')
  const [callError, setCallError] = useState('')
  const [callPhase, setCallPhase] = useState<'ringing' | 'active' | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [muted, setMuted] = useState(false)
  const [pendingReply, setPendingReply] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pendingRef = useRef('')
  const pendingActionsRef = useRef<ChatAction[]>([])
  const unmountListenersRef = useRef<(() => void) | null>(null)

  const loadHistory = useCallback(async () => {
    const res = await api<{ language: string; messages: ChatMessage[] }>('/api/chat/history')
    setLanguage(res.language)
    setMessages(res.messages)
  }, [])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  useEffect(() => {
    // A doctor can write into this thread at any time, and there are no sockets.
    // Skipped while a send is in flight: the optimistic user message and the
    // typed-out reply are local-only until finishReply, so refetching mid-send
    // would wipe them off the screen.
    if (busy || pendingReply) return
    const t = setInterval(() => void loadHistory(), 12000)
    return () => clearInterval(t)
  }, [loadHistory, busy, pendingReply])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, pendingReply])

  const finishReply = useCallback(() => {
    if (!pendingRef.current) return
    const reply = pendingRef.current
    const actions = pendingActionsRef.current
    pendingRef.current = ''
    pendingActionsRef.current = []
    setPendingReply('')
    setMessages((m) => [
      ...m,
      {
        _id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: reply,
        metadata: actions.length ? { actions } : undefined,
        createdAt: new Date().toISOString(),
      },
    ])
    setBusy(false)
  }, [])

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || busy) return
      setInput('')
      setMessages((m) => [
        ...m,
        {
          _id: `user-${Date.now()}`,
          role: 'user',
          content: trimmed,
          createdAt: new Date().toISOString(),
        },
      ])
      setBusy(true)
      try {
        const res = await api<SendResult>('/api/chat/message', {
          method: 'POST',
          body: JSON.stringify({ message: trimmed }),
        })
        pendingRef.current = res.reply
        pendingActionsRef.current = res.actions ?? []
        setPendingReply(res.reply)
      } catch {
        pendingRef.current =
          'Sorry, I could not reach the AI service right now. Please try again shortly.'
        pendingActionsRef.current = []
        setPendingReply(pendingRef.current)
      }
    },
    [busy],
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  const onFile = async (file: File) => {
    setBusy(true)
    setMessages((m) => [
      ...m,
      {
        _id: `user-${Date.now()}`,
        role: 'user',
        content: `I've uploaded my report: ${file.name}`,
        createdAt: new Date().toISOString(),
      },
    ])
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api<SendResult>('/api/chat/document', {
        method: 'POST',
        body: fd,
      })
      pendingRef.current = res.reply
      pendingActionsRef.current = res.actions ?? []
      setPendingReply(res.reply)
    } catch (e) {
      pendingRef.current =
        e instanceof Error
          ? e.message
          : 'Upload failed. Please try another file (max 5MB).'
      pendingActionsRef.current = []
      setPendingReply(pendingRef.current)
    }
  }

  const resetCallUi = useCallback(() => {
    stopRingtone()
    unmountListenersRef.current?.()
    unmountListenersRef.current = null
    setCallPhase(null)
    setCallState('idle')
    setSpeaking(false)
    setMuted(false)
  }, [])

  useEffect(() => {
    return () => {
      stopRingtone()
      unmountListenersRef.current?.()
    }
  }, [])

  const toggleCall = async () => {
    if (callPhase === 'ringing' || callPhase === 'active') {
      await stopCall()
      resetCallUi()
      return
    }
    const fail = (msg: string) => {
      resetCallUi()
      setCallError(msg)
      setCallState('unavailable')
      setTimeout(() => setCallState('idle'), 5000)
    }
    if (!isCallConfigured()) {
      fail(
        "Voice calling isn't configured. Add VITE_VAPI_PUBLIC_KEY to apps/frontend/.env and restart the dev server.",
      )
      return
    }
    setCallState('starting')
    setCallPhase('ringing')
    startRingtone()
    try {
      const unsubscribe = await startCall(language, {
        onStartSuccess: () => {
          stopRingtone()
          setCallPhase('active')
          setCallState('active')
        },
        onStartFailed: (error) => fail(`Call failed: ${error}`),
        onCallEnd: () => resetCallUi(),
        onSpeechStart: () => setSpeaking(true),
        onSpeechEnd: () => setSpeaking(false),
        // The server drops the call summary into this same thread.
        onSummarized: () => {
          loadHistory().catch(() => {})
        },
      })
      unmountListenersRef.current = unsubscribe
    } catch (e) {
      // ponytail: show the real reason (404, mic denied, no assistant) instead of blaming config
      fail(`Call failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleMute = () => setMuted(toggleMute())

  return (
    <div className="chat-screen">
      <div className="chat-header">
        <div className="wa-avatar">+</div>
        <div className="chat-header-info">
          <div className="chat-header-title">MedAssist AI</div>
          <div className="chat-header-status">{busy ? 'typing…' : 'online'}</div>
        </div>
        <div className="chat-tools">
          <button
            className={`call-btn ${callPhase ? 'active' : ''}`}
            onClick={toggleCall}
            aria-label={callPhase ? 'End call' : 'Call'}
          >
            {callPhase ? <EndCallIcon /> : <CallIcon />}
          </button>
        </div>
      </div>

      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && !busy && (
          <div className="wa-empty">
            <div className="wa-empty-title">Hello 👋</div>
            <div>
              I'm MedAssist AI. Ask me about your symptoms, book a consultation, request a
              medical certificate, or upload a report for analysis.
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m._id} className={`msg ${m.role === 'user' ? 'msg-user' : 'msg-ai'}`}>
            <div className={`msg-bubble${m.metadata?.author === 'doctor' ? ' msg-doctor' : ''}`}>
              {m.metadata?.author === 'doctor' && (
                <div className="msg-author">
                  Dr. {m.metadata.doctorName ?? 'your doctor'}
                </div>
              )}
              <div className="msg-text">{m.content}</div>
              <div className="msg-meta">
                <span className="msg-time">{fmtTime(m.createdAt)}</span>
                {m.role === 'user' && <TicksIcon />}
              </div>
            </div>
            {m.metadata?.actions?.length ? (
              <ActionStrip actions={m.metadata.actions} />
            ) : null}
          </div>
        ))}
        {pendingReply && (
          <div className="msg msg-ai">
            <AiBubble text={pendingReply} onDone={finishReply} />
          </div>
        )}
        {busy && !pendingReply && (
          <div className="msg msg-ai">
            <div className="msg-bubble typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        {callState === 'unavailable' && (
          <div className="msg msg-ai">
            <div className="msg-bubble">
              <div className="msg-text">{callError}</div>
            </div>
          </div>
        )}
      </div>

      <div className="quick-actions">
        {QUICK_ACTIONS.map((q) => (
          <button
            key={q.label}
            className="chip"
            onClick={() => (q.upload ? fileRef.current?.click() : send(q.label))}
          >
            {q.label}
          </button>
        ))}
      </div>

      <div className="chat-input">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
            e.target.value = ''
          }}
        />
        <button className="icon-btn attach" onClick={() => fileRef.current?.click()} title="Attach medical report">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.4 11.1l-8.5 8.5a6 6 0 0 1-8.5-8.5l8.5-8.5a4 4 0 0 1 5.7 5.7l-8.5 8.5a2 2 0 0 1-2.8-2.8l8.5-8.5" /></svg>
        </button>
        <textarea
          rows={1}
          placeholder="Message MedAssist AI…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button className="icon-btn send" onClick={() => send(input)} disabled={busy || !input.trim()} title="Send">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
        </button>
      </div>

      {callPhase && (
        <CallModal
          phase={callPhase}
          speaking={speaking}
          muted={muted}
          onToggleMute={handleMute}
          onEnd={() => {
            stopCall()
            resetCallUi()
          }}
        />
      )}
    </div>
  )
}
