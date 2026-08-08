import { useState } from 'react'
import { useSearchParams, Navigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { homeFor } from '../roles'

export function Login() {
  const [params] = useSearchParams()
  const { user, login, register } = useAuth()

  const [mode, setMode] = useState<'login' | 'register'>('login')
  const initialRole = params.get('role') === 'doctor' ? 'doctor' : 'patient'
  const [role, setRole] = useState<'patient' | 'doctor'>(initialRole)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [specialty, setSpecialty] = useState('General Medicine')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // No worker button here on purpose: workers are provisioned and seeded, not
  // self-registered, so the register payload stays patient|doctor.
  // homeFor returns /login for a role with no workspace; navigating there from
  // here would be a redirect to ourselves, so fall through to the form instead.
  if (user && homeFor(user.role) !== '/login') {
    return <Navigate to={homeFor(user.role)} replace />
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'login') {
        await login(phone, password)
      } else {
        await register({ phone, password, name, role, specialty })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-left">
        <div className="brand" style={{ borderBottom: 'none', marginBottom: 20 }}>
          <div className="brand-mark">+</div>
          <div>
            <div className="brand-name" style={{ color: '#fff' }}>MedAssist</div>
            <div className="brand-sub" style={{ color: 'rgba(255,255,255,0.7)' }}>Health AI</div>
          </div>
        </div>
        <h1>AI answers first. Doctors verify everything.</h1>
        <p>
          Call or chat with MedAssist for health guidance, book doctor call-backs, get reports
          analyzed, and download doctor-signed medical certificates.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
          <div className="auth-feature">
            <div className="auth-feature-icon">🎙️</div>
            <div>Talk to the AI agent over the phone in English, Hindi or Bengali</div>
          </div>
          <div className="auth-feature">
            <div className="auth-feature-icon">🩺</div>
            <div>AI reads your medical documents, then a doctor verifies the result</div>
          </div>
          <div className="auth-feature">
            <div className="auth-feature-icon">📄</div>
            <div>Doctor-signed certificates, ready to download as PDF</div>
          </div>
        </div>
      </div>

      <div className="auth-right">
        <div className="auth-card">
          <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
          <div className="auth-sub">
            {mode === 'login' ? 'Sign in to continue' : 'One phone number is all you need'}
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
            <button
              className={role === 'patient' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
              onClick={() => setRole('patient')}
              type="button"
            >
              Patient
            </button>
            <button
              className={role === 'doctor' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
              onClick={() => setRole('doctor')}
              type="button"
            >
              Doctor
            </button>
          </div>

          {error && <div className="auth-error">{error}</div>}

          <form onSubmit={submit}>
            {mode === 'register' && (
              <div className="field">
                <label>Full name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
            )}
            <div className="field">
              <label>Phone number</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91XXXXXXXXXX"
                required
              />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </div>
            {mode === 'register' && role === 'doctor' && (
              <div className="field">
                <label>Specialty</label>
                <input value={specialty} onChange={(e) => setSpecialty(e.target.value)} />
              </div>
            )}
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <div className="auth-switch">
            {mode === 'login' ? 'New here? ' : 'Already registered? '}
            <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
