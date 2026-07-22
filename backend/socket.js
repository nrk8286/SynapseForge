import { Server } from 'socket.io'
import { randomUUID } from 'node:crypto'
import { getSessionUser, parseCookies, SESSION_COOKIE } from './security.js'

function serializeMessage(row) {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    user: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
      avatarColor: row.avatar_color,
    },
  }
}

export function listMessages(db, limit = 50) {
  const rows = db.prepare(`
    SELECT messages.*, users.username, users.display_name, users.avatar_color
    FROM messages JOIN users ON users.id = messages.user_id
    ORDER BY messages.created_at DESC LIMIT ?
  `).all(limit)
  return rows.reverse().map(serializeMessage)
}

export function setupSocket(server, db, allowedOrigins) {
  const io = new Server(server, {
    cors: {
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) return callback(null, true)
        return callback(new Error('Invalid request origin'))
      },
      credentials: true,
    },
  })

  io.use((socket, next) => {
    const token = parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE]
    const user = getSessionUser(db, token)
    if (!user) return next(new Error('Authentication required'))
    socket.data.user = user
    next()
  })

  io.on('connection', (socket) => {
    socket.emit('chat:history', listMessages(db))

    socket.on('chat:send', (rawBody, acknowledge) => {
      const body = String(rawBody ?? '').trim()
      if (!body || body.length > 1000) {
        acknowledge?.({ ok: false, error: 'Messages must be between 1 and 1,000 characters.' })
        return
      }
      const message = {
        id: randomUUID(),
        userId: socket.data.user.id,
        body,
        createdAt: new Date().toISOString(),
      }
      db.prepare(`
        INSERT INTO messages (id, user_id, body, created_at)
        VALUES (@id, @userId, @body, @createdAt)
      `).run(message)
      const response = { ...message, user: socket.data.user }
      io.emit('chat:message', response)
      acknowledge?.({ ok: true })
    })
  })

  return io
}
