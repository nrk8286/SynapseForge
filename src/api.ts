export type User = {
  id: string
  username: string
  displayName: string
  avatarColor: string
  createdAt: string
}

export type Post = {
  id: string
  content: string
  videoUrl: string | null
  createdAt: string
  user: User
}

export type Notification = {
  id: string
  message: string
  read: boolean
  createdAt: string
}

export type Message = {
  id: string
  body: string
  createdAt: string
  user: User
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...init, headers, credentials: 'include' })
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const body = await response.json() as { error?: string }
      if (body.error) message = body.error
    } catch {
      // Keep the status-based fallback when the response is not JSON.
    }
    throw new ApiError(message, response.status)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function timeAgo(dateText: string) {
  const elapsed = Math.max(0, Date.now() - new Date(dateText).getTime())
  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
  ]
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  for (const [size, unit] of units) {
    if (elapsed >= size) return formatter.format(-Math.floor(elapsed / size), unit)
  }
  return 'just now'
}
