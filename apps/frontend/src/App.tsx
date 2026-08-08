import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './App.css'
import { AuthProvider, useAuth } from './store/auth'
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

function PatientRoutes() {
  const { user } = useAuth()
  if (user?.role !== 'patient') return <Navigate to="/doctor" replace />
  return <Layout />
}

function DoctorRoutes() {
  const { user } = useAuth()
  if (user?.role !== 'doctor') return <Navigate to="/chat" replace />
  return <Layout />
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
                <PatientRoutes />
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
                <DoctorRoutes />
              </Protected>
            }
          >
            <Route path="/doctor" element={<DoctorOverview />} />
            <Route path="/doctor/callbacks" element={<CallBacks />} />
            <Route path="/doctor/verify" element={<Verification />} />
            <Route path="/doctor/records" element={<Records />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
