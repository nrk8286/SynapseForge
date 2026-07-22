import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApplication } from './app.js'

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'synapseforge-'))
const { app, db } = createApplication({
  databasePath: join(temporaryDirectory, 'test.db'),
  uploadDir: join(temporaryDirectory, 'uploads'),
  distDir: join(temporaryDirectory, 'missing-dist'),
  publicOrigin: 'http://127.0.0.1',
  cookieSecure: false,
  loginLimiter: { limit: 100 },
})
const server = createServer(app)
let baseUrl

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  db.close()
  rmSync(temporaryDirectory, { recursive: true, force: true })
})

async function request(path, options = {}) {
  const headers = new Headers(options.headers)
  if (options.body && typeof options.body === 'string') headers.set('Content-Type', 'application/json')
  return fetch(`${baseUrl}${path}`, { ...options, headers })
}

test('health, authentication, feed, upload, notifications, and logout work together', async () => {
  const health = await request('/api/health')
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { status: 'ok', version: '2.0.0' })

  const registration = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'builder_one', displayName: 'Builder One', password: 'correct-horse-72' }),
  })
  assert.equal(registration.status, 201)
  const registered = await registration.json()
  assert.equal(registered.user.username, 'builder_one')
  assert.equal('password_hash' in registered.user, false)
  const cookie = registration.headers.get('set-cookie').split(';')[0]
  assert.match(cookie, /^synapse_session=/)

  const session = await request('/api/auth/session', { headers: { cookie } })
  assert.equal(session.status, 200)
  assert.equal((await session.json()).user.displayName, 'Builder One')

  const emptyFeed = await request('/api/feed', { headers: { cookie } })
  assert.deepEqual((await emptyFeed.json()).posts, [])

  const uploadBody = new FormData()
  uploadBody.append('video', new Blob([Buffer.from('video-test')], { type: 'video/mp4' }), 'launch.mp4')
  const upload = await request('/api/videos', { method: 'POST', headers: { cookie }, body: uploadBody })
  assert.equal(upload.status, 201)
  const { videoUrl } = await upload.json()
  assert.match(videoUrl, /^\/uploads\/.+\.mp4$/)

  const creation = await request('/api/feed', {
    method: 'POST', headers: { cookie }, body: JSON.stringify({ content: 'The first production post.', videoUrl }),
  })
  assert.equal(creation.status, 201)
  const createdPost = (await creation.json()).post
  assert.equal(createdPost.user.username, 'builder_one')

  const feed = await request('/api/feed', { headers: { cookie } })
  assert.equal((await feed.json()).posts.length, 1)

  const notifications = await request('/api/notifications', { headers: { cookie } })
  assert.equal((await notifications.json()).notifications[0].read, false)
  assert.equal((await request('/api/notifications/read-all', { method: 'POST', headers: { cookie } })).status, 204)

  assert.equal((await request(`/api/feed/${createdPost.id}`, { method: 'DELETE', headers: { cookie } })).status, 204)
  assert.equal((await request('/api/auth/logout', { method: 'POST', headers: { cookie } })).status, 204)
  const endedSession = await request('/api/auth/session', { headers: { cookie } })
  assert.equal(endedSession.status, 200)
  assert.equal((await endedSession.json()).user, null)
})

test('login rejects bad credentials, accepts valid credentials, and blocks unknown browser origins', async () => {
  const invalid = await request('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ username: 'builder_one', password: 'not-the-password' }),
  })
  assert.equal(invalid.status, 401)
  assert.equal((await invalid.json()).error, 'Username or password is incorrect.')

  const valid = await request('/api/auth/login', {
    method: 'POST', body: JSON.stringify({ username: 'builder_one', password: 'correct-horse-72' }),
  })
  assert.equal(valid.status, 200)
  assert.match(valid.headers.get('set-cookie'), /HttpOnly/)

  const blocked = await request('/api/auth/login', {
    method: 'POST',
    headers: { origin: 'https://attacker.invalid' },
    body: JSON.stringify({ username: 'builder_one', password: 'correct-horse-72' }),
  })
  assert.equal(blocked.status, 403)
  assert.equal((await blocked.json()).error, 'Invalid request origin')
})

test('protected routes require a session and registration validates inputs', async () => {
  assert.equal((await request('/api/feed')).status, 401)
  const weak = await request('/api/auth/register', {
    method: 'POST', body: JSON.stringify({ username: 'x', displayName: 'X', password: 'short' }),
  })
  assert.equal(weak.status, 400)
})
