import compression from 'compression'
import express from 'express'
import helmet from 'helmet'
import multer from 'multer'
import { existsSync, mkdirSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { createDatabase, createNotification, publicUser } from './database.js'
import {
  clearSessionCookie,
  createSession,
  getSessionUser,
  hashPassword,
  hashToken,
  normalizeUsername,
  parseCookies,
  requireUser,
  SESSION_COOKIE,
  setSessionCookie,
  verifyPassword,
} from './security.js'
import { listMessages } from './socket.js'

const AVATAR_COLORS = ['#ee6c4d', '#47b7a5', '#8b7cf6', '#e6ad4b', '#4b8fe2', '#d76591']
const VIDEO_TYPES = new Map([
  ['video/mp4', '.mp4'],
  ['video/webm', '.webm'],
  ['video/quicktime', '.mov'],
])

function parseOrigins(value) {
  return String(value ?? '').split(',').map((origin) => origin.trim()).filter(Boolean)
}

function createLoginLimiter({ windowMs = 15 * 60 * 1000, limit = 10 } = {}) {
  const attempts = new Map()
  return (req, res, next) => {
    const key = req.ip
    const now = Date.now()
    const entry = attempts.get(key)
    if (!entry || entry.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }
    entry.count += 1
    if (entry.count > limit) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)))
      return res.status(429).json({ error: 'Too many sign-in attempts. Try again shortly.' })
    }
    next()
  }
}

function postView(row) {
  return {
    id: row.id,
    content: row.content,
    videoUrl: row.video_url,
    createdAt: row.created_at,
    user: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
      avatarColor: row.avatar_color,
    },
  }
}

export function createApplication(options = {}) {
  const production = options.production ?? process.env.NODE_ENV === 'production'
  const databasePath = options.databasePath ?? process.env.DATABASE_PATH ?? './data/synapseforge.db'
  const uploadDir = resolve(options.uploadDir ?? process.env.UPLOAD_DIR ?? './uploads')
  const distDir = resolve(options.distDir ?? './dist')
  const publicOrigin = options.publicOrigin ?? process.env.PUBLIC_ORIGIN ?? 'http://localhost:3101'
  const developmentOrigins = production ? [] : ['http://127.0.0.1:5173', 'http://localhost:5173']
  const allowedOrigins = new Set([publicOrigin, ...developmentOrigins, ...parseOrigins(options.allowedOrigins ?? process.env.ALLOWED_ORIGINS)])
  const cookieSecure = options.cookieSecure ?? process.env.COOKIE_SECURE === 'true'
  const sessionDays = Number(options.sessionDays ?? process.env.SESSION_DAYS ?? 14)
  const db = options.db ?? createDatabase(databasePath)
  mkdirSync(uploadDir, { recursive: true })

  const app = express()
  app.disable('x-powered-by')
  if (process.env.TRUST_PROXY && process.env.TRUST_PROXY !== '0') app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1)
  app.use(helmet({
    contentSecurityPolicy: production ? undefined : false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
  }))
  app.use(compression())
  app.use(express.json({ limit: '64kb' }))
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })

  app.use((req, res, next) => {
    const origin = req.get('origin')
    if (origin && !allowedOrigins.has(origin)) return res.status(403).json({ error: 'Invalid request origin' })
    if (origin) {
      res.set('Access-Control-Allow-Origin', origin)
      res.set('Access-Control-Allow-Credentials', 'true')
      res.set('Vary', 'Origin')
    }
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Headers', 'Content-Type')
      res.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
      return res.sendStatus(204)
    }
    next()
  })

  app.get('/api/health', (_req, res) => {
    const database = db.prepare('SELECT 1 AS ok').get()
    res.json({ status: database.ok === 1 ? 'ok' : 'degraded', version: '2.0.0' })
  })

  const loginLimiter = createLoginLimiter(options.loginLimiter)
  app.post('/api/auth/register', loginLimiter, async (req, res, next) => {
    try {
      const username = normalizeUsername(req.body?.username)
      const displayName = String(req.body?.displayName ?? '').trim()
      const password = String(req.body?.password ?? '')
      if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        return res.status(400).json({ error: 'Username must be 3–24 letters, numbers, or underscores.' })
      }
      if (displayName.length < 2 || displayName.length > 50) {
        return res.status(400).json({ error: 'Display name must be between 2 and 50 characters.' })
      }
      if (password.length < 10 || password.length > 128) {
        return res.status(400).json({ error: 'Password must be between 10 and 128 characters.' })
      }
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
        return res.status(409).json({ error: 'That username is already in use.' })
      }
      const userRow = {
        id: randomUUID(),
        username,
        display_name: displayName,
        password_hash: await hashPassword(password),
        avatar_color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
        created_at: new Date().toISOString(),
      }
      db.prepare(`
        INSERT INTO users (id, username, display_name, password_hash, avatar_color, created_at)
        VALUES (@id, @username, @display_name, @password_hash, @avatar_color, @created_at)
      `).run(userRow)
      createNotification(db, userRow.id, 'Welcome to SynapseForge. Your workspace is ready.')
      const session = createSession(db, userRow.id, sessionDays)
      setSessionCookie(res, session.token, session.expiresAt, cookieSecure)
      return res.status(201).json({ user: publicUser(userRow) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/auth/login', loginLimiter, async (req, res, next) => {
    try {
      const username = normalizeUsername(req.body?.username)
      const password = String(req.body?.password ?? '')
      const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
      if (!row || !(await verifyPassword(password, row.password_hash))) {
        return res.status(401).json({ error: 'Username or password is incorrect.' })
      }
      const session = createSession(db, row.id, sessionDays)
      setSessionCookie(res, session.token, session.expiresAt, cookieSecure)
      return res.json({ user: publicUser(row) })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/auth/session', (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
    const user = getSessionUser(db, token)
    res.json({ user })
  })

  app.post('/api/auth/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
    clearSessionCookie(res, cookieSecure)
    res.sendStatus(204)
  })

  const authenticated = requireUser(db)
  app.get('/api/feed', authenticated, (_req, res) => {
    const rows = db.prepare(`
      SELECT posts.*, users.username, users.display_name, users.avatar_color
      FROM posts JOIN users ON users.id = posts.user_id
      ORDER BY posts.created_at DESC LIMIT 100
    `).all()
    res.json({ posts: rows.map(postView) })
  })

  app.post('/api/feed', authenticated, (req, res) => {
    const content = String(req.body?.content ?? '').trim()
    const videoUrl = req.body?.videoUrl ? String(req.body.videoUrl) : null
    if ((!content && !videoUrl) || content.length > 2000) {
      return res.status(400).json({ error: 'Add a message or video; messages can be up to 2,000 characters.' })
    }
    if (videoUrl && !/^\/uploads\/[a-zA-Z0-9_-]+\.(mp4|webm|mov)$/.test(videoUrl)) {
      return res.status(400).json({ error: 'Invalid video reference.' })
    }
    const post = {
      id: randomUUID(), userId: req.user.id, content, videoUrl, createdAt: new Date().toISOString(),
    }
    db.prepare(`
      INSERT INTO posts (id, user_id, content, video_url, created_at)
      VALUES (@id, @userId, @content, @videoUrl, @createdAt)
    `).run(post)
    res.status(201).json({ post: { ...post, user: req.user } })
  })

  app.delete('/api/feed/:id', authenticated, (req, res) => {
    const result = db.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id)
    if (!result.changes) return res.status(404).json({ error: 'Post not found.' })
    res.sendStatus(204)
  })

  app.get('/api/notifications', authenticated, (req, res) => {
    const rows = db.prepare(`
      SELECT id, message, read, created_at FROM notifications
      WHERE user_id = ? ORDER BY created_at DESC LIMIT 100
    `).all(req.user.id)
    res.json({ notifications: rows.map((row) => ({
      id: row.id, message: row.message, read: Boolean(row.read), createdAt: row.created_at,
    })) })
  })

  app.post('/api/notifications/read-all', authenticated, (req, res) => {
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id)
    res.sendStatus(204)
  })

  const storage = multer.diskStorage({
    destination: uploadDir,
    filename(_req, file, callback) {
      const extension = VIDEO_TYPES.get(file.mimetype) ?? extname(file.originalname).toLowerCase()
      callback(null, `${randomBytes(18).toString('base64url')}${extension}`)
    },
  })
  const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024, files: 1 },
    fileFilter(_req, file, callback) {
      callback(null, VIDEO_TYPES.has(file.mimetype))
    },
  })
  app.post('/api/videos', authenticated, upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose an MP4, WebM, or MOV video.' })
    res.status(201).json({ videoUrl: `/uploads/${req.file.filename}` })
  })
  app.use('/uploads', authenticated, express.static(uploadDir, { fallthrough: false, maxAge: '7d' }))

  app.post('/api/creator/assist', authenticated, (req, res) => {
    const topic = String(req.body?.topic ?? '').trim().slice(0, 180)
    const tone = ['clear', 'bold', 'warm'].includes(req.body?.tone) ? req.body.tone : 'clear'
    if (topic.length < 3) return res.status(400).json({ error: 'Give the creator assistant a topic.' })
    const openers = {
      clear: `A practical thought on ${topic}:`,
      bold: `The usual take on ${topic} misses the point.`,
      warm: `I keep coming back to this idea about ${topic}.`,
    }
    res.json({
      suggestions: [
        `${openers[tone]} Here is what I learned, what changed, and the next step worth trying.`,
        `${openers[tone]} Three observations from the work: what helped, what surprised me, and what I would do differently.`,
        `${openers[tone]} What is one experience that changed how you see it?`,
      ],
    })
  })

  app.get('/api/chat/messages', authenticated, (_req, res) => {
    res.json({ messages: listMessages(db) })
  })

  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }))

  if (existsSync(distDir)) {
    app.use(express.static(distDir, { index: false, maxAge: production ? '1h' : 0 }))
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/uploads/')) return next()
      res.sendFile(resolve(distDir, 'index.html'))
    })
  }

  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Video files must be 100 MB or smaller.' })
    }
    if (error instanceof multer.MulterError) return res.status(400).json({ error: error.message })
    console.error(error)
    res.status(500).json({ error: 'The server could not complete that request.' })
  })

  return { app, db, allowedOrigins }
}
