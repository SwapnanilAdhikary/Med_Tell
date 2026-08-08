import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import './App.css'
import { AuthProvider, useAuth } from './store/auth'
import { homeFor } from './roles'
import { Layout } from './components/Layout'
import { Chat } from './components/Chat'
import { Uploads } from './components/Uploads'
import { Appointments } from './components/Appointments'
import { Certificates } from './components/Certificates'
import { Profile } from './components/Profile'
import { DoctorOverview } from './components/doctor/Overview'
import { CallBacks } from './components/doctor/CallBacks'
import { Verification } from './components/doctor/Verification'
import { Records } from './components/doctor/Records'
import { Landing } from './components/Landing'
import { Login } from './components/Login'

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function EmptyPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="content">
      <div className="card">
        <div className="empty-state">
          <div className="empty-title">{title}</div>
          <div>{children}</div>
        </div>
      </div>
    </div>
  )
}

function RequireRole({ roles }: { roles: string[] }) {
  const { user, logout } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/login" replace />
  if (roles.includes(user.role)) return <Layout />

  if (homeFor(user.role) === location.pathname) {
    return (
      <EmptyPage title="No workspace for this account">
        The <span className="mono">{user.role}</span> role has no screens yet.
        <div>
          <button className="btn btn-secondary btn-sm" style={{ marginTop: 14 }} onClick={logout}>
            Sign out
          </button>
        </div>
      </EmptyPage>
    )
  }
  return <Navigate to={homeFor(user.role)} replace />
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <Protected>
                <RequireRole roles={['patient']} />
              </Protected>
            }
          >
            <Route path="/chat" element={<Chat />} />
            <Route path="/uploads" element={<Uploads />} />
            <Route path="/appointments" element={<Appointments />} />
            <Route path="/certificates" element={<Certificates />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
          <Route
            element={
              <Protected>
                <RequireRole roles={['doctor', 'admin']} />
              </Protected>
            }
          >
            <Route path="/doctor" element={<DoctorOverview />} />
            <Route path="/doctor/callbacks" element={<CallBacks />} />
            <Route path="/doctor/verify" element={<Verification />} />
            <Route path="/doctor/records" element={<Records />} />
          </Route>
          <Route
            element={
              <Protected>
                <RequireRole roles={['health_worker']} />
              </Protected>
            }
          >
            {/* ponytail: a placeholder, not scaffolding - HOME.health_worker
                points here, so without a real route a worker login loops
                through Landing. PR 5 replaces this with the capture screens. */}
            <Route
              path="/field"
              element={
                <EmptyPage title="Field reporting is not built yet">
                  Your account is set up as an ASHA / ANM worker. The report capture screens arrive
                  in the next release.
                </EmptyPage>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
