let audioCtx: AudioContext | null = null
let cycleTimer: number | null = null
let active = false

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!audioCtx) audioCtx = new AC()
  if (audioCtx.state === 'suspended') void audioCtx.resume()
  return audioCtx
}

function ringOnce(ac: AudioContext, at: number) {
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  const lfo = ac.createOscillator()
  const lfoGain = ac.createGain()

  osc.type = 'sine'
  osc.frequency.setValueAtTime(440, at)

  lfo.type = 'sine'
  lfo.frequency.setValueAtTime(18, at)
  lfoGain.gain.setValueAtTime(6, at)
  lfo.connect(lfoGain)
  lfoGain.connect(osc.frequency)

  gain.gain.setValueAtTime(0, at)
  gain.gain.linearRampToValueAtTime(0.5, at + 0.02)
  gain.gain.setValueAtTime(0.5, at + 0.28)
  gain.gain.linearRampToValueAtTime(0.0001, at + 0.4)

  osc.connect(gain)
  lfo.connect(gain)
  gain.connect(ac.destination)

  osc.start(at)
  lfo.start(at)
  osc.stop(at + 0.42)
  lfo.stop(at + 0.42)
}

function ringCycle(ac: AudioContext, startAt: number) {
  ringOnce(ac, startAt)
  ringOnce(ac, startAt + 0.55)
}

const CYCLE = 4.5

export function startRingtone() {
  stopRingtone()
  const ac = getCtx()
  if (!ac) return
  active = true
  let next = ac.currentTime + 0.1
  const schedule = () => {
    if (!active) return
    ringCycle(ac, next)
    next += CYCLE
    cycleTimer = window.setTimeout(schedule, CYCLE * 1000 - 40)
  }
  schedule()
}

export function stopRingtone() {
  active = false
  if (cycleTimer !== null) {
    window.clearTimeout(cycleTimer)
    cycleTimer = null
  }
}
