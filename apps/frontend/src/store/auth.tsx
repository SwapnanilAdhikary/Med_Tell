import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, setToken, clearToken, getToken } from '../api/client'
import type { AuthUser } from '../api/types'

const USER_KEY = 'medassist_user'

function cachedUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

function saveUser(user: AuthUser | null) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
  else localStorage.removeItem(USER_KEY)
}

interface AuthState {
  user: AuthUser | null
  loading: boolean
  login: (phone: string, password: string) => Promise<AuthUser>
  register: (data: {
    phone: string
    password: string
    name: string
    role: 'patient' | 'doctor'
    specialty?: string
  }) => Promise<AuthUser>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const hydrate = useCallback(async () => {
    if (!getToken()) {
      saveUser(null)
      setUser(null)
      setLoading(false)
      return
    }
    const cached = cachedUser()
    if (cached) setUser(cached)
    setLoading(false)
    try {
      const me = await api<AuthUser>('/api/auth/me')
      setUser(me)
      saveUser(me)
    } catch {
      /* 401 already handled by the API client */
    }
  }, [])

  useEffect(() => {
    hydrate()
  }, [hydrate])

  const login = useCallback(async (phone: string, password: string) => {
    const res = await api<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, password }),
    })
    setToken(res.token)
    setUser(res.user)
    saveUser(res.user)
    return res.user
  }, [])

  const register = useCallback(
    async (data: {
      phone: string
      password: string
      name: string
      role: 'patient' | 'doctor'
      specialty?: string
    }) => {
      const res = await api<{ token: string; user: AuthUser }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(data),
      })
      setToken(res.token)
      setUser(res.user)
      saveUser(res.user)
      return res.user
    },
    [],
  )

  const logout = useCallback(() => {
    clearToken()
    saveUser(null)
    setUser(null)
    window.location.href = '/'
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
