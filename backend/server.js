import { createServer } from 'node:http'
import { createApplication } from './app.js'
import { setupSocket } from './socket.js'

const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 3101)
const { app, db, allowedOrigins } = createApplication()
const server = createServer(app)
setupSocket(server, db, allowedOrigins)

server.listen(port, host, () => {
  console.log(`SynapseForge listening on http://${host}:${port}`)
})

function shutdown(signal) {
  console.log(`${signal} received; closing SynapseForge`)
  server.close(() => {
    db.close()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
