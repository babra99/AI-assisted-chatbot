# AI-Assisted Appointment Booking

Full-stack appointment booking application with an AI chatbot powered by Mistral. Built for the **Full Stack Developer — Technical Skills Assessment**.

React + Express + PostgreSQL + Mistral AI.

## Architecture

```mermaid
graph LR
  Browser["React SPA<br/>(Vite)"]
  API["Express API<br/>(Node.js)"]
  DB[(PostgreSQL)]
  AI["Mistral AI<br/>(mistral-small-latest)"]

  Browser -- REST / JSON --> API
  API -- SQL / pg pool --> DB
  API -- HTTPS / JSON --> AI
```

| Layer | Technology | Role |
|-------|-----------|------|
| Frontend | React 19, React Router 7, Vite 8, TypeScript 6 | SPA with auth, chat, booking UI |
| Backend | Express 5, TypeScript 7, Node.js 20+ | REST API, JWT auth, validation, rate limiting |
| Database | PostgreSQL 13+ | Users, appointments, chat sessions (JSONB) |
| AI | Mistral `mistral-small-latest` | Natural-language appointment extraction |

The AI interprets natural language into structured appointment fields. All AI output is validated server-side before any database write. Users confirm details in a review step before the booking API is called.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+ (LTS recommended)
- npm 10+
- PostgreSQL 13+ (16+ recommended; the API starts without it)

## Project structure

```text
.
├── client/            React + Vite + TypeScript (frontend)
│   └── src/
│       ├── api/         Authenticated fetch wrapper, token storage
│       ├── auth/        Login, register, context, route guard
│       └── chat/        Chat page, booking panel, types
├── server/            Express + TypeScript (backend API)
│   ├── src/
│   │   ├── ai/          Mistral service, AI routes
│   │   ├── appointments/ CRUD routes
│   │   ├── auth/        Register, login, JWT middleware
│   │   ├── chat/        Multi-turn session routes
│   │   ├── config/      Database pool, env loader
│   │   └── middleware/   Rate limiter, validator, logger
│   └── tests/           Vitest test suite
├── db/                SQL schema (idempotent)
└── README.md
```

## Quick start

```bash
# 1. Install dependencies
npm install
npm install --prefix server
npm install --prefix client

# 2. Configure environment
cp server/.env.example server/.env   # edit DATABASE_URL, JWT_SECRET
cp client/.env.example client/.env   # defaults work for local dev

# 3. Create database and apply schema
npm run db:init

# 4. Start both servers
npm run dev
```

Frontend opens at `http://localhost:5173`, API at `http://localhost:3001`.

## Environment variables

### Backend (`server/.env`)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `PORT` | No | `3001` | API listen port |
| `CLIENT_ORIGIN` | No | `http://localhost:5173` | CORS allowed origin |
| `DATABASE_URL` | Yes* | — | PostgreSQL connection string |
| `JWT_SECRET` | Yes | — | Signing key for JWTs (use a long random string) |
| `MISTRAL_API_KEY` | No | — | Mistral AI API key (AI features disabled without it) |
| `NODE_ENV` | No | `development` | `production` enables JWT_SECRET length warning |

*The API starts without `DATABASE_URL` but database endpoints return 503.

### Frontend (`client/.env`)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `VITE_API_BASE_URL` | No | `http://localhost:3001` | Backend URL for browser requests |

Never commit real secrets. The `.gitignore` excludes all `.env` files. Placeholder values live in `.env.example` files.

## Database setup

### 1. Create the database

```bash
# With peer auth (Linux default):
sudo -u postgres psql -c "CREATE DATABASE appointment_booking;"

# Or with password auth:
sudo -u postgres psql -c "CREATE ROLE myuser WITH LOGIN PASSWORD 'mypassword';"
sudo -u postgres psql -c "CREATE DATABASE appointment_booking OWNER myuser;"
```

### 2. Set `DATABASE_URL` in `server/.env`

```bash
# Peer auth (Unix socket):
DATABASE_URL=postgresql:///appointment_booking?host=/var/run/postgresql

# Password auth:
DATABASE_URL=postgresql://myuser:mypassword@localhost:5432/appointment_booking
```

### 3. Apply the schema

```bash
npm run db:init
```

This runs `db/schema.sql` against the configured database. The schema uses `IF NOT EXISTS` and `CREATE OR REPLACE` so it is safe to rerun.

**Schema overview:**
- `users` — accounts with bcrypt-hashed passwords
- `appointments` — bookings with date, time, service, status; foreign key to users with CASCADE delete
- `chat_sessions` — conversation history stored as JSONB array; foreign key to users

All tables use UUID primary keys via `gen_random_uuid()`. Mutable tables have `updated_at` maintained by a PostgreSQL trigger.

## Mistral AI configuration

The AI features require a [Mistral API key](https://console.mistral.ai/). Set `MISTRAL_API_KEY` in `server/.env`.

Without the key, the API starts normally but AI endpoints (`/api/ai/interpret`, `/api/chat/:id/messages`) return 503. Appointment booking via the manual form works without AI.

**Model details:**
- Model: `mistral-small-latest`
- Response format: JSON mode (`response_format: { type: "json_object" }`)
- Temperature: 0 (deterministic)
- Timeout: 15 seconds
- Max tokens: 256

## Authentication

JWT-based authentication with 7-day token expiry. Tokens are stored in `localStorage` on the frontend.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/register` | No | Create account (name, email, password) |
| POST | `/api/auth/login` | No | Authenticate (email, password) |
| GET | `/api/auth/me` | Yes | Return current user profile |

```bash
# Register
curl -s -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com","password":"secret123"}'

# Login
curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"secret123"}'

# Profile (use the token from register or login)
curl http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer <token>"
```

**Validation rules:**
- Email: basic format check, case-insensitive, unique
- Password: 8–72 characters (bcrypt truncates at 72 bytes)
- Name: 1–255 characters

## API endpoints

### Appointments

All endpoints require `Authorization: Bearer <token>`. Users can only access their own appointments.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/appointments` | Book a new appointment |
| GET | `/api/appointments` | List appointments (`?status=pending\|confirmed\|cancelled`) |
| GET | `/api/appointments/:id` | Get a single appointment |
| PATCH | `/api/appointments/:id` | Update fields (service, date, time, status) |
| PATCH | `/api/appointments/:id/cancel` | Cancel an appointment |

```bash
# Create appointment
curl -X POST http://localhost:3001/api/appointments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"service_name":"Haircut","appointment_date":"2026-12-01","appointment_time":"10:00"}'
```

**Validation:** service_name 1–255 chars, date YYYY-MM-DD (valid calendar date), time HH:MM (24h), no past bookings, no duplicate date+time per user.

### AI interpretation

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/ai/interpret` | Yes | Parse natural language into appointment fields |

### Chat sessions

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/chat` | Yes | Create a new chat session |
| GET | `/api/chat` | Yes | List your sessions |
| GET | `/api/chat/:sessionId` | Yes | Get session with message history |
| POST | `/api/chat/:sessionId/messages` | Yes | Send message, get AI response |
| DELETE | `/api/chat/:sessionId` | Yes | Delete session |

Chat replies include a `ready` flag. When `true`, all appointment fields are collected and the frontend shows a review/confirm step before calling `POST /api/appointments`.

### Health checks

```bash
curl http://localhost:3001/api/health      # API health (always 200)
curl http://localhost:3001/api/health/db    # Database health (200 or 503)
```

## Security

- **Authentication:** bcrypt password hashing (10 salt rounds), JWT with HS256
- **Authorization:** every appointment/chat query includes `WHERE user_id = $1` — ownership enforced at the SQL level
- **Input validation:** UUID format checked before DB queries; max-length caps on name (255), password (72), service_name (255), chat text (1000); date/time format and calendar validity; past-date rejection
- **Rate limiting:** in-memory sliding-window per-IP — global (200/min), auth (20/15min), AI (10/min), chat (15/min)
- **Request body:** 100 KB limit via `express.json({ limit: "100kb" })`
- **CORS:** locked to `CLIENT_ORIGIN`
- **Logging:** structured logs mask emails, redact database URLs, never log passwords/tokens/API keys
- **Parameterized queries:** all SQL uses `$1` placeholders via `pg` — no string interpolation
- **Error handling:** try-catch on every route handler; global error handler sanitizes before logging; clients receive generic "Internal server error"

## Tests

The backend test suite uses [Vitest](https://vitest.dev/) with [Supertest](https://github.com/ladjs/supertest). All external dependencies (database, Mistral API) are mocked — no real database or paid API calls required.

```bash
# Run all tests
npm test --prefix server

# Watch mode
npm run test:watch --prefix server
```

**Test coverage:**

| File | Tests | Areas |
|------|-------|-------|
| `auth.test.ts` | 22 | Register, login, /me, token validation, input limits |
| `appointments.test.ts` | 27 | CRUD, ownership enforcement, UUID validation, date/time/length checks, duplicates |
| `chat.test.ts` | 18 | Session lifecycle, multi-turn context passing, AI failure forwarding, message persistence |
| `ai-service.test.ts` | 21 | Mistral request format, timeout/network/auth/rate-limit errors, response parsing, `validateExtraction` |
| `validation.test.ts` | 7 | UUID validator (valid, invalid, undefined, arrays) |
| **Total** | **95** | |

## Development

```bash
npm run dev              # Start both server and client
npm run dev:server       # API only — http://localhost:3001
npm run dev:client       # Frontend only — http://localhost:5173
```

## Build

```bash
npm run build            # Build both server and client
npm run build --prefix server   # Server only (tsc)
npm run build --prefix client   # Client only (tsc + vite build)
```

Production server start (after build):

```bash
node server/dist/index.js
```

The client build outputs static files to `client/dist/` — serve with any static file server or reverse proxy.

## Deployment

The application is not deployed. Below are practical options for hosting this stack.

### Option A: Platform-as-a-Service (Railway, Render, Fly.io)

These platforms support Node.js + PostgreSQL with minimal configuration.

**General steps:**

1. Push the repo to GitHub.
2. Create a PostgreSQL database on the platform.
3. Create a web service pointing to the repo. Set the build and start commands:
   ```
   Build:  npm install --prefix server && npm run build --prefix server && npm install --prefix client && npm run build --prefix client
   Start:  node server/dist/index.js
   ```
4. Set environment variables on the platform dashboard:
   - `DATABASE_URL` — provided by the platform's PostgreSQL addon
   - `JWT_SECRET` — generate with `openssl rand -base64 48`
   - `MISTRAL_API_KEY` — from [console.mistral.ai](https://console.mistral.ai/)
   - `CLIENT_ORIGIN` — the deployed frontend URL
   - `NODE_ENV=production`
5. Run the schema initializer once (platform console or one-off command):
   ```
   npm run db:init --prefix server
   ```
6. Serve `client/dist/` as static files (configure the platform to serve from this directory or use a CDN).

### Option B: VPS / Docker (manual)

1. Provision a server with Node.js 20+ and PostgreSQL.
2. Clone the repo, install dependencies, build, and apply the schema.
3. Use a process manager (`pm2`, systemd) to run `node server/dist/index.js`.
4. Serve `client/dist/` with nginx/caddy as a reverse proxy.
5. Set environment variables in the shell or a `.env` file (not committed).

### Production checklist

- [ ] `JWT_SECRET` is a random string of 32+ characters
- [ ] `NODE_ENV=production`
- [ ] `CLIENT_ORIGIN` matches the deployed frontend URL exactly
- [ ] HTTPS enabled (via platform or reverse proxy)
- [ ] `DATABASE_URL` uses SSL (`?sslmode=require`) if connecting over the network
- [ ] `MISTRAL_API_KEY` is set (or AI features are intentionally disabled)
- [ ] Schema has been applied (`npm run db:init`)
- [ ] Rate limiter is replaced with a shared store (Redis) if running multiple instances

## Troubleshooting

**`JWT_SECRET is required` on server start**
Set `JWT_SECRET` in `server/.env`. Copy from `server/.env.example` if missing.

**`Database not available` (503) on API calls**
Check that `DATABASE_URL` is set in `server/.env` and PostgreSQL is running. Verify with `npm run db:init`.

**`AI service not configured` (503) on chat/interpret**
Set `MISTRAL_API_KEY` in `server/.env`. Appointment booking via the manual form works without it.

**`AI service timed out` (502)**
The Mistral API did not respond within 15 seconds. Retry the request. Check your network and Mistral's [status page](https://status.mistral.ai/).

**CORS errors in browser console**
Ensure `CLIENT_ORIGIN` in `server/.env` matches the frontend URL exactly (protocol, host, port). Do not include a trailing slash.

**`Invalid or expired token` (401)**
Log in again to get a fresh token. Tokens expire after 7 days.

**Port already in use**
Another process is using port 3001 or 5173. Change `PORT` in `server/.env` or stop the conflicting process.

**Tests fail with import errors**
Run `npm install --prefix server` to ensure vitest and supertest are installed.

## Design decisions

- The API starts without `DATABASE_URL` or `MISTRAL_API_KEY` so frontend development is not blocked by external service availability. Missing services return 503.
- AI output is always validated on the backend — the model never writes to the database directly. Users see a review step before booking.
- `chat_sessions.messages` uses JSONB for flexible message storage without a separate messages table.
- `updated_at` columns are maintained by a PostgreSQL trigger rather than application code.
- UUIDs use PostgreSQL's `gen_random_uuid()` (available since PostgreSQL 13).
- In-memory rate limiting avoids external dependencies for a single-process prototype. A production multi-instance deployment would need a shared store.
- Chat history is trimmed to the last 20 turns before sending to Mistral to stay within token limits.

## License

Private assessment submission.
