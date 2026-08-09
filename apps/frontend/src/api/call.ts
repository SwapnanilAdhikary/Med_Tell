import { api } from '../api/client'

const PUBLIC_KEY = import.meta.env.VITE_VAPI_PUBLIC_KEY as string | undefined

export type CallState = 'idle' | 'starting' | 'active' | 'ended' | 'unavailable'

export interface MatchedDoctor {
  id: string
  name: string
  title?: string
  specialty: string
}

/** What the backend made of the call once it had the transcript. */
export interface CallOutcome {
  linked: boolean
  appointmentId?: string
  certificateId?: string
  matchedDoctor?: MatchedDoctor | null
}

/** What the field call returns instead of patient triage. */
export interface FieldCallOutcome {
  kind: 'report' | 'note' | 'none'
  reportId?: string
  noteId?: string
  matchedDoctor?: { name: string; specialty: string; title?: string } | null
  subjectReachable?: boolean
  transcript?: string
  reason?: string
}

export interface CallListeners<T = CallOutcome> {
  onStartSuccess?: () => void
  onStartFailed?: (error: string) => void
  onCallEnd?: () => void
  onSpeechStart?: () => void
  onSpeechEnd?: () => void
  /** Fires once the server has summarised the call and routed it to a doctor. */
  onSummarized?: (outcome: T) => void
  /**
   * The transcript could not be filed. Without this the caller cannot tell
   * "saved as a note" from "the request failed", which matters a lot more for a
   * worker filing a case than for a patient chat.
   */
  onSummariseFailed?: (error: string) => void
  /** The call ended with nothing transcribed, so there was nothing to file. */
  onNothingHeard?: () => void
}

export interface CallOptions {
  /** Defaults preserve the patient paths exactly. */
  sessionPath?: string
  completePath?: string
  /** Merged into the complete-call body, e.g. the tapped map point. */
  extra?: Record<string, unknown>
}

interface VapiLike {
  start: (assistantId: string, opts?: Record<string, unknown>) => Promise<unknown>
  stop: () => Promise<void>
  setMuted: (muted: boolean) => void
  isMuted: () => boolean
  on: (event: string, listener: (...args: unknown[]) => void) => void
  removeListener: (event: string, listener: (...args: unknown[]) => void) => void
}

interface CallConfig {
  assistantId: string
  language: string
  firstMessage: string
  variableValues: Record<string, string>
}

interface TranscriptTurn {
  role: string
  content: string
}

let vapiInstance: VapiLike | null = null

export function resolveVapiCtor(mod: any) {
  for (const c of [mod?.default?.default, mod?.default, mod?.Vapi, mod]) {
    if (typeof c === 'function') return c
  }
  throw new Error('@vapi-ai/web exported no constructor')
}

async function getVapi() {
  if (vapiInstance) return vapiInstance
  if (!PUBLIC_KEY) return null
  const Vapi = resolveVapiCtor(await import('@vapi-ai/web'))
  vapiInstance = new Vapi(PUBLIC_KEY) as unknown as VapiLike
  return vapiInstance
}

export function isCallConfigured(): boolean {
  return Boolean(PUBLIC_KEY)
}

export async function getCallConfig(
  language: string,
  sessionPath = '/api/calls/session',
): Promise<CallConfig> {
  return api<CallConfig>(
    `${sessionPath}?language=${encodeURIComponent(language)}`,
  )
}

/** Pulls a finalised transcript line out of a Vapi `message` event. */
function finalTranscript(event: unknown): TranscriptTurn | null {
  const m = event as
    | { type?: string; transcriptType?: string; role?: string; transcript?: string }
    | undefined
  if (m?.type !== 'transcript' || m.transcriptType !== 'final') return null
  if (!m.transcript) return null
  return { role: m.role ?? 'user', content: m.transcript }
}

function callIdOf(value: unknown): string | undefined {
  const v = value as { id?: string; call?: { id?: string } } | undefined
  return v?.id ?? v?.call?.id
}

export async function startCall<T = CallOutcome>(
  language: string,
  listeners: CallListeners<T> = {},
  opts: CallOptions = {},
): Promise<() => void> {
  const vapi = await getVapi()
  if (!vapi) throw new Error('Voice calling is not configured (missing VITE_VAPI_PUBLIC_KEY).')
  const config = await getCallConfig(language, opts.sessionPath)
  if (!config.assistantId) {
    // Naming the actual variable: a worker hitting this needs the ASHA one.
    const envVar = opts.sessionPath?.includes('/field')
      ? 'VAPI_ASHA_ASSISTANT_ID'
      : 'VAPI_ASSISTANT_ID'
    throw new Error(`No ${envVar} configured on the backend.`)
  }

  const subs: Array<[string, (...args: unknown[]) => void]> = []
  const on = (event: string, fn: (...args: unknown[]) => void) => {
    vapi.on(event, fn)
    subs.push([event, fn])
  }

  // Web calls go browser -> Vapi directly, so Vapi's server webhook never fires
  // for them. Collect the transcript here and post it when the call ends.
  const transcript: TranscriptTurn[] = []
  const startedAt = new Date().toISOString()
  let callId: string | undefined
  let posted = false

  const postTranscript = async () => {
    if (posted) return
    posted = true
    if (!callId || transcript.length === 0) {
      listeners.onNothingHeard?.()
      return
    }
    try {
      const outcome = await api<T>(opts.completePath ?? '/api/calls/complete', {
        method: 'POST',
        body: JSON.stringify({
          vapiCallId: callId,
          transcript,
          startedAt,
          endedAt: new Date().toISOString(),
          ...(opts.extra ?? {}),
        }),
      })
      listeners.onSummarized?.(outcome)
    } catch (error) {
      console.error('Could not send the call transcript for triage', error)
      listeners.onSummariseFailed?.(
        error instanceof Error ? error.message : 'Could not file this call',
      )
    }
  }

  on('message', (event) => {
    const turn = finalTranscript(event)
    if (turn) transcript.push(turn)
  })
  on('call-start-success', (event) => {
    callId = callId ?? callIdOf(event)
    listeners.onStartSuccess?.()
  })
  on('call-start-failed', (e) => {
    const detail = e as { error?: string } | undefined
    listeners.onStartFailed?.(detail?.error ?? 'The call could not be connected.')
  })
  on('call-end', () => {
    listeners.onCallEnd?.()
    void postTranscript()
  })
  if (listeners.onSpeechStart) on('speech-start', listeners.onSpeechStart)
  if (listeners.onSpeechEnd) on('speech-end', listeners.onSpeechEnd)

  const call = await vapi.start(config.assistantId, {
    variableValues: config.variableValues,
    firstMessage: config.firstMessage,
  })
  callId = callIdOf(call) ?? callId

  return () => {
    for (const [event, fn] of subs) vapi.removeListener(event, fn)
  }
}

export async function stopCall(): Promise<void> {
  if (vapiInstance) await vapiInstance.stop()
}

export function toggleMute(): boolean {
  if (!vapiInstance) return false
  const next = !vapiInstance.isMuted()
  vapiInstance.setMuted(next)
  return next
}
