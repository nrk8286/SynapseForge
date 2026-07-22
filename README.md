# SynapseForge

SynapseForge is a focused social workspace with authenticated feeds, private video delivery, real-time chat, notifications, and creator tools. The original 2025 proof of concept is preserved in `SynapseForge_Advanced (1).zip`; the active application is the production-oriented v2 implementation in this repository.

## Supported stack

- **Client:** React 19.2, TypeScript 5.9, and Vite 8
- **API:** Node.js 22.12+ and Express 5
- **Realtime:** Socket.IO 4 with authenticated handshakes
- **Persistence:** SQLite in WAL mode through `better-sqlite3`
- **Distribution:** responsive installable PWA and a multi-stage Docker image

This replaces the archived React 17/Webpack shell. React's current documentation identifies 19.2 as the latest line, and Vite 8 supports Node 20.19+ or 22.12+. The project uses Node 24 in CI and Docker.

## Authentication model

Passwords are salted and hashed with Node's `scrypt`; plaintext passwords are never persisted or returned. A successful registration or login creates a random opaque session token. Only its SHA-256 digest is stored in SQLite, while the browser receives the token in an `HttpOnly`, `SameSite=Lax` cookie. Logout revokes the server-side session.

The production client and API share one origin. Development requests are proxied by Vite. Browser requests with an unknown `Origin` are rejected, and Socket.IO applies the same allowlist. Sign-in attempts are rate-limited. Set `COOKIE_SECURE=true` whenever the public origin uses HTTPS.

## Local development

```bash
cp .env.example .env
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. The API listens on `http://127.0.0.1:3101`; Vite proxies API, uploads, and WebSocket traffic so the browser uses a single logical origin. Port 3101 avoids the NICK.OS service already installed on port 3001.

The application creates `data/synapseforge.db` and `uploads/` on first use. Both paths are ignored by Git.

## Validation

```bash
npm run check
npm audit --omit=dev
```

`npm run check` runs ESLint, the API integration tests, TypeScript checks, and the optimized Vite build. Integration coverage exercises registration, session recovery, bad and valid login, origin rejection, feed creation/deletion, authenticated upload, notifications, logout, and protected-route behavior.

## Production

Build and run directly:

```bash
npm ci
npm run build
NODE_ENV=production \
PUBLIC_ORIGIN=https://synapseforge.example \
COOKIE_SECURE=true \
TRUST_PROXY=1 \
npm start
```

Or run the container:

```bash
PUBLIC_ORIGIN=https://synapseforge.example \
COOKIE_SECURE=true \
TRUST_PROXY=1 \
docker compose up --build -d
```

The Compose service publishes only to `127.0.0.1:3101` by default; override `HOST_PORT` if needed and place a TLS-terminating reverse proxy in front of it. Preserve the `synapseforge-data` and `synapseforge-uploads` volumes in backups. The health probe is `GET /api/health`.

Important production settings:

| Variable | Purpose |
| --- | --- |
| `PUBLIC_ORIGIN` | Exact browser-facing HTTPS origin |
| `ALLOWED_ORIGINS` | Comma-separated extra trusted origins; generally empty in production |
| `COOKIE_SECURE` | Must be `true` behind HTTPS |
| `TRUST_PROXY` | Set to `1` behind one trusted reverse proxy |
| `DATABASE_PATH` | Persistent SQLite file path |
| `UPLOAD_DIR` | Persistent private video directory |
| `SESSION_DAYS` | Session lifetime; defaults to 14 days |

SQLite is appropriate for a single application instance. Before horizontally scaling the API, migrate the database layer to PostgreSQL and move uploads to object storage; do not mount one SQLite file across multiple hosts.

## API surface

- `/api/auth/register`, `/api/auth/login`, `/api/auth/session`, `/api/auth/logout`
- `/api/feed` and `/api/feed/:id`
- `/api/videos` and authenticated `/uploads/*`
- `/api/notifications` and `/api/notifications/read-all`
- `/api/chat/messages` plus authenticated Socket.IO events
- `/api/creator/assist`
- `/api/health`

## License

GNU General Public License v3.0. See `LICENSE`.
