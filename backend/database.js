import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

export function createDatabase(databasePath = './data/synapseforge.db') {
  const resolvedPath = databasePath === ':memory:' ? databasePath : resolve(databasePath)
  if (resolvedPath !== ':memory:') mkdirSync(dirname(resolvedPath), { recursive: true })

  const db = new Database(resolvedPath)
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  if (resolvedPath !== ':memory:') db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_color TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL DEFAULT '',
      video_url TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS posts_created_at ON posts(created_at DESC);

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notifications_user_id ON notifications(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_created_at ON messages(created_at DESC);
  `)

  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString())
  return db
}

export function publicUser(row) {
  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
    createdAt: row.created_at,
  }
}

export function createNotification(db, userId, message) {
  const notification = {
    id: randomUUID(),
    userId,
    message,
    createdAt: new Date().toISOString(),
  }
  db.prepare(`
    INSERT INTO notifications (id, user_id, message, created_at)
    VALUES (@id, @userId, @message, @createdAt)
  `).run(notification)
  return notification
}

