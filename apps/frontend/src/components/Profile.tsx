import { useEffect, useState } from 'react'
import { api, apiJson } from '../api/client'
import type { Patient } from '../api/types'

export function Profile() {
  const [profile, setProfile] = useState<Patient | null>(null)
  const [language, setLanguage] = useState('en')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api<Patient>('/api/patients/me')
      .then((p) => {
        setProfile(p)
        setLanguage(p.language ?? 'en')
      })
      .catch(() => undefined)
  }, [])

  if (!profile) return <div className="loading">Loading…</div>

  const set = (patch: Partial<Patient>) => setProfile((p) => (p ? { ...p, ...patch } : p))

  const flashSaved = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const save = async () => {
    await api('/api/patients/me', { method: 'PATCH', body: JSON.stringify(profile) })
    flashSaved()
  }

  const changeLanguage = async (value: string) => {
    setLanguage(value)
    set({ language: value })
    await apiJson('/api/chat/language', { language: value })
    flashSaved()
  }

  return (
    <div className="content" style={{ maxWidth: 640 }}>
      <div className="card">
        <div className="card-title">Health profile</div>
        <div className="card-sub">
          Used by the AI assistant to give you more relevant guidance.
        </div>
        <div style={{ marginTop: 20 }}>
          <div className="field">
            <label>Full name</label>
            <input value={profile.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="field">
            <label>Preferred language</label>
            <select value={language} onChange={(e) => changeLanguage(e.target.value)}>
              <option value="en">English</option>
              <option value="hi">हिन्दी</option>
              <option value="bn">বাংলা</option>
            </select>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
              Used by the AI assistant for chats and voice calls.
            </div>
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label>Gender</label>
              <select value={profile.gender ?? ''} onChange={(e) => set({ gender: e.target.value })}>
                <option value="">Prefer not to say</option>
                <option>Female</option>
                <option>Male</option>
                <option>Other</option>
              </select>
            </div>
            <div className="field">
              <label>Blood group</label>
              <select value={profile.bloodGroup ?? ''} onChange={(e) => set({ bloodGroup: e.target.value })}>
                <option value="">Unknown</option>
                {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Known allergies (comma separated)</label>
            <input
              value={(profile.healthProfile?.allergies ?? []).join(', ')}
              onChange={(e) =>
                set({
                  healthProfile: {
                    allergies: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                    conditions: profile.healthProfile?.conditions ?? [],
                    medications: profile.healthProfile?.medications ?? [],
                  },
                })
              }
            />
          </div>
          <div className="field">
            <label>Ongoing conditions (comma separated)</label>
            <input
              value={(profile.healthProfile?.conditions ?? []).join(', ')}
              onChange={(e) =>
                set({
                  healthProfile: {
                    allergies: profile.healthProfile?.allergies ?? [],
                    conditions: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                    medications: profile.healthProfile?.medications ?? [],
                  },
                })
              }
            />
          </div>
          <div className="field">
            <label>Current medications (comma separated)</label>
            <input
              value={(profile.healthProfile?.medications ?? []).join(', ')}
              onChange={(e) =>
                set({
                  healthProfile: {
                    allergies: profile.healthProfile?.allergies ?? [],
                    conditions: profile.healthProfile?.conditions ?? [],
                    medications: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                  },
                })
              }
            />
          </div>
          <button className="btn btn-primary" onClick={save}>
            {saved ? 'Saved ✓' : 'Save profile'}
          </button>
        </div>
      </div>
    </div>
  )
}
