import { apiUrl } from './base'

export { apiUrl } from './base'

const TOKEN_KEY = 'medassist_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  }
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(apiUrl(path), { ...options, headers })
  if (res.status === 401) {
    clearToken()
    localStorage.removeItem('medassist_user')
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (Array.isArray(body.message)) message = body.message[0]
      else if (typeof body.message === 'string') message = body.message
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const apiJson = (path: string, body: unknown) =>
  api(path, { method: 'POST', body: JSON.stringify(body) })

/**
 * Downloads a guarded file. A plain <a href> can't send the bearer token, so
 * every document/certificate link 401s without this.
 */
export async function openAuthedFile(path: string): Promise<void> {
  const token = getToken()
  const res = await fetch(apiUrl(path), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error(`Could not open file (${res.status})`)

  const url = URL.createObjectURL(await res.blob())
  window.open(url, '_blank', 'noopener')
  // ponytail: fixed delay instead of tracking the child window - the blob only
  // has to outlive the browser reading it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
