import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { homeFor } from '../roles'

const FEATURES = [
  {
    icon: '🎙️',
    title: 'Call the AI agent',
    desc: 'Dial one number and talk to MedAssist in English, Hindi or Bengali. Get guidance, book consultations, and request certificates by voice.',
  },
  {
    icon: '💬',
    title: 'WhatsApp-style chat',
    desc: 'Message the AI anytime. It triages symptoms, schedules a doctor call-back, and drafts your medical documents.',
  },
  {
    icon: '🩺',
    title: 'AI reads your reports',
    desc: 'Upload prescriptions, lab reports or scans. AI extracts findings — and a licensed doctor verifies every result.',
  },
  {
    icon: '📄',
    title: 'Verified certificates',
    desc: 'Sick leave, fitness, or insurance letters drafted by AI and signed by a doctor. Download as a signed PDF.',
  },
  {
    icon: '🧑‍⚕️',
    title: 'Doctor workspace',
    desc: 'Doctors get a verification queue, call-back jobs with AI notes, and an audit trail of every decision.',
  },
  {
    icon: '🚨',
    title: 'Emergency red-flag routing',
    desc: 'Critical symptoms are never “advised on” — the agent routes you to human help and emergency services immediately.',
  },
]

export function Landing() {
  const { user } = useAuth()
  if (user) {
    return <Navigate to={homeFor(user.role)} replace />
  }
  return (
    <div className="landing">
      <nav className="landing-nav">
        <div className="brand" style={{ borderBottom: 'none', marginBottom: 0, padding: 0 }}>
          <div className="brand-mark">+</div>
          <div>
            <div className="brand-name">MedAssist</div>
            <div className="brand-sub">Health AI</div>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <Link to="/login" className="btn btn-secondary">
            Patient sign in
          </Link>
          <Link to="/login" className="btn btn-secondary">
            ASHA / ANM sign in
          </Link>
          <Link to="/login?role=doctor" className="btn btn-primary">
            Doctor workspace
          </Link>
        </div>
      </nav>

      <section className="landing-hero">
        <h1>Your hospital, in your pocket.</h1>
        <p>
          MedAssist is a one-stop AI front desk for hospitals and patients. Call, chat, or upload
          a report — AI handles the triage, and human doctors verify every medical decision.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <Link to="/login" className="btn btn-primary" style={{ padding: '12px 24px' }}>
            Start chatting
          </Link>
          <Link to="/login?role=doctor" className="btn btn-secondary" style={{ padding: '12px 24px' }}>
            I'm a doctor
          </Link>
        </div>
      </section>

      <section className="landing-features">
        {FEATURES.map((f) => (
          <div key={f.title} className="card">
            <div style={{ fontSize: 26 }}>{f.icon}</div>
            <div className="card-title" style={{ marginTop: 10 }}>
              {f.title}
            </div>
            <div className="card-sub" style={{ marginTop: 6 }}>
              {f.desc}
            </div>
          </div>
        ))}
      </section>

      <footer className="landing-foot">
        MedAssist is a demonstration prototype. AI outputs are always human-verified and are not a
        substitute for professional medical advice.
      </footer>
    </div>
  )
}
