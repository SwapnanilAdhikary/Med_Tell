import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api } from '../../api/client'
import { getFix, type GeoState } from '../../api/geo'
import type { FieldReport, FieldReportVitals, Urgency } from '../../api/types'
import { URGENCIES, VITALS } from './labels'
import { VoiceRecorder } from './VoiceRecorder'
import type { PickedPoint } from './CaptureSheet'

interface FormState {
  name: string
  phone: string
  age: string
  ageUnit: 'years' | 'months'
  gender: '' | 'female' | 'male' | 'other'
  pregnant: boolean
  pregnancyMonths: string
  symptoms: string
  duration: string
  trend: '' | 'improving' | 'stable' | 'worsening'
  urgency: Urgency
  dangerSigns: string
  narrative: string
  vitals: Record<string, string>
}

const EMPTY: FormState = {
  name: '',
  phone: '',
  age: '',
  ageUnit: 'years',
  gender: '',
  pregnant: false,
  pregnancyMonths: '',
  symptoms: '',
  duration: '',
  trend: '',
  urgency: 'routine',
  dangerSigns: '',
  narrative: '',
  vitals: {},
}

const csv = (value: string) =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

/** A woman of reproductive age is the only case where the question is relevant. */
function showPregnancy(form: FormState): boolean {
  const years = form.ageUnit === 'years' ? Number(form.age) : Number(form.age) / 12
  return form.gender === 'female' && (!form.age || (years >= 12 && years <= 55))
}

function GeoStrip({
  geo,
  pinned,
  onRetry,
}: {
  geo: GeoState
  pinned?: PickedPoint
  onRetry: () => void
}) {
  // A point handed over from the map wins: the worker chose it deliberately.
  if (pinned) {
    return (
      <div className="geo-strip">
        <span className="pill pill-info">
          {pinned.picked ? 'Pinned on the map' : 'Your location'}
        </span>
        <span className="geo-reason mono">
          {pinned.lat.toFixed(5)}, {pinned.lng.toFixed(5)}
        </span>
        <Link className="btn btn-secondary btn-sm" to="/field/map">
          Change on map
        </Link>
      </div>
    )
  }
  return (
    <div className="geo-strip">
      {geo.status === 'locating' && (
        <span className="pill pill-neutral">Finding your location…</span>
      )}
      {geo.status === 'ready' && (
        <span className="pill pill-info">
          GPS locked{geo.fix.accuracyM != null ? ` ±${geo.fix.accuracyM} m` : ''}
        </span>
      )}
      {geo.status === 'unavailable' && (
        <>
          <span className="pill pill-warning">Assigned area will be used</span>
          <span className="geo-reason">{geo.reason}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
            Retry
          </button>
        </>
      )}
      {geo.status === 'ready' && (
        <span className="geo-reason">Tagged to where you are standing now.</span>
      )}
    </div>
  )
}

function Filed({ report, onAnother }: { report: FieldReport; onAnother: () => void }) {
  const doctor = report.matchedDoctor
  return (
    <div className="content" style={{ maxWidth: 640 }}>
      <div className="card">
        <span className="pill pill-success">Report filed</span>
        <h2 className="card-title" style={{ marginTop: 12 }}>
          Filed for {typeof report.patient === 'string' ? 'the patient' : report.patient.name}
        </h2>
        <div className="action-card" style={{ marginTop: 12, maxWidth: 'none' }}>
          {doctor
            ? `Matched with Dr. ${doctor.name} (${doctor.specialty}). They have been notified.`
            : 'No doctor is on the roster yet, so nobody has been notified. Tell your supervisor.'}
        </div>
        {report.status === 'failed' && (
          <div className="action-card" style={{ marginTop: 8, maxWidth: 'none' }}>
            The report is saved, but routing it to a doctor failed. Your supervisor can retry it.
          </div>
        )}
        {report.aiError && (
          <div className="action-card" style={{ marginTop: 8, maxWidth: 'none' }}>
            The assistant could not read your notes, so the doctor sees them exactly as you wrote
            them.
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={onAnother}>
            File another report
          </button>
          <Link className="btn btn-secondary" to={`/field/reports/${report._id}`}>
            View this report
          </Link>
        </div>
      </div>
    </div>
  )
}

export function NewReport() {
  const routed = (useLocation().state ?? {}) as {
    point?: PickedPoint
    startRecording?: boolean
  }
  const [form, setForm] = useState<FormState>(EMPTY)
  const [geo, setGeo] = useState<GeoState>({ status: 'idle' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [filed, setFiled] = useState<FieldReport | null>(null)

  const locate = () => {
    setGeo({ status: 'locating' })
    getFix().then(setGeo)
  }

  useEffect(() => {
    // No need to ask for GPS when the map already handed us a point.
    if (!routed.point) locate()
  }, [routed.point])

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }))
  const setVital = (key: string, value: string) =>
    setForm((f) => ({ ...f, vitals: { ...f.vitals, [key]: value } }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)

    const vitals: FieldReportVitals = {}
    for (const v of VITALS) {
      const raw = form.vitals[v.key]
      if (raw != null && raw !== '') vitals[v.key] = Number(raw)
    }

    const age = form.age === '' ? undefined : Number(form.age)
    const body = {
      subject: {
        name: form.name.trim(),
        phone: form.phone.trim(),
        ...(age != null && form.ageUnit === 'years' ? { ageYears: age } : {}),
        ...(age != null && form.ageUnit === 'months' ? { ageMonths: age } : {}),
        ...(form.gender ? { gender: form.gender } : {}),
        ...(showPregnancy(form) && form.pregnant ? { pregnant: true } : {}),
        ...(form.pregnancyMonths ? { pregnancyMonths: Number(form.pregnancyMonths) } : {}),
      },
      ...(form.symptoms ? { symptoms: csv(form.symptoms) } : {}),
      ...(form.duration ? { duration: form.duration.trim() } : {}),
      ...(form.trend ? { trend: form.trend } : {}),
      urgency: form.urgency,
      ...(form.dangerSigns ? { dangerSigns: csv(form.dangerSigns) } : {}),
      ...(Object.keys(vitals).length ? { vitals } : {}),
      ...(form.narrative ? { narrative: form.narrative.trim() } : {}),
      ...(routed.point
        ? {
            geo: {
              lat: routed.point.lat,
              lng: routed.point.lng,
              picked: routed.point.picked,
              ...(routed.point.accuracyM != null && !routed.point.picked
                ? { accuracyM: routed.point.accuracyM }
                : {}),
            },
          }
        : geo.status === 'ready'
          ? { geo: geo.fix }
          : {}),
    }

    try {
      setFiled(await api<FieldReport>('/api/field-reports', {
        method: 'POST',
        body: JSON.stringify(body),
      }))
    } catch (err) {
      // Never clear the form on failure - the worker may be on one bar of signal.
      setError(err instanceof Error ? err.message : 'Could not file the report')
    } finally {
      setBusy(false)
    }
  }

  if (filed) {
    return (
      <Filed
        report={filed}
        onAnother={() => {
          setFiled(null)
          setForm(EMPTY)
          locate()
        }}
      />
    )
  }

  return (
    <div className="content" style={{ maxWidth: 720 }}>
      <form className="card" onSubmit={submit}>
        <h2 className="card-title">New field report</h2>
        <div className="card-sub">
          You are reporting on someone else. A doctor reviews everything you file.
        </div>

        <GeoStrip geo={geo} pinned={routed.point} onRetry={locate} />

        <VoiceRecorder
          autoStart={routed.startRecording}
          onTranscript={(text) =>
            set({ narrative: form.narrative ? `${form.narrative}\n${text}` : text })
          }
        />

        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}

        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="fr-name">Name of the person *</label>
            <input
              id="fr-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              required
              maxLength={120}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="fr-phone">Their phone number *</label>
            <input
              id="fr-phone"
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => set({ phone: e.target.value })}
              placeholder="+91XXXXXXXXXX"
              required
              maxLength={20}
            />
            <div className="field-hint">
              The doctor&apos;s reply goes to this number. Read it back to be sure.
            </div>
          </div>
        </div>

        <div className="grid grid-4">
          <div className="field">
            <label htmlFor="fr-age">Age</label>
            <input
              id="fr-age"
              type="number"
              inputMode="numeric"
              min={0}
              value={form.age}
              onChange={(e) => set({ age: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="fr-age-unit">Age in</label>
            <select
              id="fr-age-unit"
              value={form.ageUnit}
              onChange={(e) => set({ ageUnit: e.target.value as FormState['ageUnit'] })}
            >
              <option value="years">Years</option>
              <option value="months">Months</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="fr-gender">Gender</label>
            <select
              id="fr-gender"
              value={form.gender}
              onChange={(e) => set({ gender: e.target.value as FormState['gender'] })}
            >
              <option value="">Not recorded</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </select>
          </div>
          {showPregnancy(form) && (
            <div className="field">
              <label htmlFor="fr-preg-months">Months pregnant</label>
              <select
                id="fr-preg-months"
                value={form.pregnant ? form.pregnancyMonths || '' : ''}
                onChange={(e) =>
                  set({ pregnant: e.target.value !== '', pregnancyMonths: e.target.value })
                }
              >
                <option value="">Not pregnant</option>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="field">
          <label htmlFor="fr-symptoms">Symptoms (comma separated)</label>
          <input
            id="fr-symptoms"
            value={form.symptoms}
            onChange={(e) => set({ symptoms: e.target.value })}
            placeholder="fever, cough, not feeding"
          />
        </div>

        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="fr-duration">How long</label>
            <input
              id="fr-duration"
              value={form.duration}
              onChange={(e) => set({ duration: e.target.value })}
              placeholder="3 days"
            />
          </div>
          <div className="field">
            <label htmlFor="fr-trend">Getting</label>
            <select
              id="fr-trend"
              value={form.trend}
              onChange={(e) => set({ trend: e.target.value as FormState['trend'] })}
            >
              <option value="">Not recorded</option>
              <option value="improving">Better</option>
              <option value="stable">Same</option>
              <option value="worsening">Worse</option>
            </select>
          </div>
        </div>

        <details className="collapse">
          <summary>Vitals you measured (optional)</summary>
          <p className="field-hint" style={{ margin: '8px 0 12px' }}>
            Only fill in what you actually measured. Leave the rest blank — never estimate.
          </p>
          <div className="grid grid-4">
            {VITALS.map((v) => (
              <div className="field" key={v.key}>
                <label htmlFor={`fr-${v.key}`}>
                  {v.label} <span className="field-unit">{v.unit}</span>
                </label>
                <input
                  id={`fr-${v.key}`}
                  type="number"
                  inputMode="decimal"
                  step={v.step}
                  min={v.min}
                  max={v.max}
                  value={form.vitals[v.key] ?? ''}
                  onChange={(e) => setVital(v.key, e.target.value)}
                />
              </div>
            ))}
          </div>
        </details>

        <div className="field">
          <label htmlFor="fr-danger">Danger signs seen (comma separated)</label>
          <input
            id="fr-danger"
            value={form.dangerSigns}
            onChange={(e) => set({ dangerSigns: e.target.value })}
            placeholder="chest indrawing, unable to drink"
          />
        </div>

        <div className="field">
          <label htmlFor="fr-narrative">In your own words</label>
          <textarea
            id="fr-narrative"
            rows={4}
            maxLength={8000}
            value={form.narrative}
            onChange={(e) => set({ narrative: e.target.value })}
            placeholder="What you saw, what the family said, anything the doctor should know."
          />
        </div>

        <fieldset className="field urgency-set">
          <legend>How urgent is this?</legend>
          <div className="urgency-row">
            {URGENCIES.map((u) => (
              <button
                key={u.value}
                type="button"
                className={`urgency-btn${form.urgency === u.value ? ' is-selected' : ''}`}
                aria-pressed={form.urgency === u.value}
                onClick={() => set({ urgency: u.value })}
              >
                <span className={`pill ${u.cls}`}>{u.label}</span>
              </button>
            ))}
          </div>
          <div className="field-hint">
            Your judgement is never lowered. The assistant may raise it.
          </div>
        </fieldset>

        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Filing…' : 'File report'}
        </button>
      </form>
    </div>
  )
}
