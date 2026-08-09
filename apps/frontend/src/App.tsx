import { Suspense, lazy } from 'react'
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
import { PatientChat } from './components/doctor/PatientChat'
import { Landing } from './components/Landing'
import { Login } from './components/Login'
import { NewReport } from './components/field/NewReport'
import { MyReports } from './components/field/MyReports'
import { ReportDetail } from './components/field/ReportDetail'
import { WorkerProfile } from './components/field/WorkerProfile'
import { NotesList, NoteEditor } from './components/field/Notes'
import { FieldCall } from './components/field/FieldCall'

// mapbox-gl is ~1.8MB. Split out so patients and doctors never download it.
const FieldMap = lazy(() =>
  import('./components/field/FieldMap').then((m) => ({ default: m.FieldMap })),
)

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
            <Route path="/doctor/chat/:patientId" element={<PatientChat />} />
          </Route>
          <Route
            element={
              <Protected>
                <RequireRole roles={['health_worker']} />
              </Protected>
            }
          >
            <Route path="/field" element={<NewReport />} />
            <Route path="/field/reports" element={<MyReports />} />
            <Route path="/field/reports/:id" element={<ReportDetail />} />
            <Route
              path="/field/map"
              element={
                <Suspense fallback={<div className="loading">Loading the map…</div>}>
                  <FieldMap />
                </Suspense>
              }
            />
            <Route path="/field/call" element={<FieldCall />} />
            <Route path="/field/notes" element={<NotesList />} />
            <Route path="/field/notes/:id" element={<NoteEditor />} />
            <Route path="/field/profile" element={<WorkerProfile />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
