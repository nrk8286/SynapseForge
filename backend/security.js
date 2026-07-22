import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { publicUser } from './database.js'

const scrypt = promisify(scryptCallback)
export const SESSION_COOKIE = 'synapse_session'

export function normalizeUsername(value) {
  return String(value ?? '').trim().toLowerCase()
}

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, 64)
  return `scrypt$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`
}

export async function verifyPassword(password, encoded) {
  const [algorithm, saltText, hashText] = String(encoded).split('$')
  if (algorithm !== 'scrypt' || !saltText || !hashText) return false
  const stored = Buffer.from(hashText, 'base64url')
  const derived = Buffer.from(await scrypt(password, Buffer.from(saltText, 'base64url'), stored.length))
  return stored.length === derived.length && timingSafeEqual(stored, derived)
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
      const separator = part.indexOf('=')
      if (separator < 0) return [part, '']
      return [decodeURIComponent(part.slice(0, separator)), decodeURIComponent(part.slice(separator + 1))]
    }),
  )
}

export function createSession(db, userId, sessionDays = 14) {
  const token = randomBytes(32).toString('base64url')
  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + sessionDays * 24 * 60 * 60 * 1000)
  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(hashToken(token), userId, createdAt.toISOString(), expiresAt.toISOString())
  return { token, expiresAt }
}

export function getSessionUser(db, token) {
  if (!token) return null
  const row = db.prepare(`
    SELECT users.* FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashToken(token), new Date().toISOString())
  return publicUser(row)
}

export function setSessionCookie(res, token, expiresAt, secure) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
}

export function clearSessionCookie(res, secure) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
  })
}

export function requireUser(db) {
  return (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
    const user = getSessionUser(db, token)
    if (!user) return res.status(401).json({ error: 'Authentication required' })
    req.user = user
    req.sessionToken = token
    next()
  }
}

