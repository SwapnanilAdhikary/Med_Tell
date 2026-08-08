import { useEffect, useRef, useState } from 'react'
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { api } from '../api/client'
import { homeFor, ROLE_LABEL, SUBTITLE } from '../roles'
import type { AppNotification } from '../api/types'

function Bell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])
  const [unread, setUnread] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const load = async () => {
    const [list, count] = await Promise.all([
      api<AppNotification[]>('/api/notifications'),
      api<{ count: number }>('/api/notifications/unread-count'),
    ])
    setItems(list)
    setUnread(count.count)
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const openPanel = async () => {
    setOpen((o) => !o)
    if (!open) await load()
  }

  const markRead = async (id: string) => {
    await api(`/api/notifications/${id}/read`, { method: 'PATCH' })
    load()
  }

  const markAll = async () => {
    await api('/api/notifications/read-all', { method: 'PATCH' })
    load()
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="bell" onClick={openPanel} aria-label="Notifications">
        <BellIcon />
        {unread > 0 && <span className="bell-dot">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="dropdown">
          <div className="dropdown-header">
            <span>Notifications</span>
            <button onClick={markAll}>Mark all read</button>
          </div>
          <div className="notif-list">
            {items.length === 0 && <div className="notif-empty">No notifications yet</div>}
            {items.map((n) => (
              <div
                key={n._id}
                className="notif-item"
                onClick={() => markRead(n._id)}
                style={n.read ? undefined : { background: 'var(--primary-soft)' }}
              >
                <div className="notif-title">{n.title}</div>
                {n.body && <div className="notif-body">{n.body}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  )
}

export function Layout() {
  const { user, loading, logout } = useAuth()
  const [badge, setBadge] = useState<Record<string, number>>({})
  const location = useLocation()
  const isChat = location.pathname === '/chat'

  useEffect(() => {
    if (!user) return
    const load = async () => {
      try {
        if (user.role === 'doctor') {
          const [summary, q] = await Promise.all([
            api<{ pending: number }>('/api/verification/summary'),
            api<unknown[]>('/api/appointments/queue'),
          ])
          setBadge({ '/doctor/callbacks': q.length, '/doctor/verify': summary.pending })
        }
      } catch {
        /* ignore */
      }
    }
    load()
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [user])

  if (loading) return <div className="loading">Loading…</div>
  if (!user) return <Navigate to="/login" replace />

  const home = homeFor(user.role)
  // Doctor and admin share one workspace, so they share one nav.
  const doctorNav = [
    { to: '/doctor', label: 'Overview', icon: <GaugeIcon /> },
    { to: '/doctor/callbacks', label: 'Call-backs', icon: <PhoneIcon /> },
    { to: '/doctor/verify', label: 'Verify', icon: <ShieldIcon /> },
    { to: '/doctor/records', label: 'Records', icon: <FileIcon /> },
  ]
  const NAV: Record<string, typeof doctorNav> = {
    patient: [
      { to: '/chat', label: 'Chat', icon: <ChatIcon /> },
      { to: '/uploads', label: 'My Reports', icon: <UploadIcon /> },
      { to: '/appointments', label: 'Appointments', icon: <CalendarIcon /> },
      { to: '/certificates', label: 'Certificates', icon: <DocIcon /> },
      { to: '/profile', label: 'Profile', icon: <UserIcon /> },
    ],
    doctor: doctorNav,
    admin: doctorNav,
    health_worker: [
      { to: '/field', label: 'New report', icon: <ClipboardIcon /> },
      { to: '/field/reports', label: 'My reports', icon: <FileIcon /> },
      { to: '/field/map', label: 'Map', icon: <MapPinIcon /> },
      { to: '/field/profile', label: 'Profile', icon: <UserIcon /> },
    ],
  }
  const navItems = NAV[user.role] ?? []

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">+</div>
          <div>
            <div className="brand-name">MedAssist</div>
            <div className="brand-sub">Health AI</div>
          </div>
        </div>
        <nav className="nav">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className="nav-link" end={item.to === home}>
              <span className="nav-icon">{item.icon}</span>
              {item.label}
              {badge[item.to] ? <span className="nav-badge">{badge[item.to]}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="avatar">{(user.name ?? user.phone)[0]?.toUpperCase()}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="user-chip-name">{user.name ?? user.phone}</div>
              <div className="user-chip-role">{ROLE_LABEL[user.role] ?? user.role}</div>
            </div>
          </div>
          <button className="logout" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        {!isChat && (
          <header className="topbar">
            <div>
              <div className="topbar-title">MedAssist Health AI</div>
              <div className="topbar-sub">{SUBTITLE[user.role] ?? ''}</div>
            </div>
            <div className="topbar-right">
              <Bell />
            </div>
          </header>
        )}
        <Outlet />
      </main>
    </div>
  )
}

const GaugeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 15l3.5-3.5M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0z" /></svg>
)
const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.4 2.1L8 9.6a16 16 0 0 0 6 6l1.2-1.3a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z" /></svg>
)
const ShieldIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
)
const FileIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
)
const ChatIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.4 8.4 0 0 1 12.5 3a8.4 8.4 0 0 1 8.5 8.5z" /></svg>
)
const UploadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5M12 3v12" /></svg>
)
const CalendarIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
)
const DocIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></svg>
)
const UserIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
)
const MapPinIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></svg>
)
const ClipboardIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12h6M9 16h4" /></svg>
)
