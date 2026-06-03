# SyncSpace

Real-time collaborative study workspace. Built solo in 5 days for the Nebula competition (MDG Space, IIT Roorkee).

## What it does

Study rooms where members share collaborative notes, a Python code editor, and live execution output. Everything in a room is synced in real time — type in one window, see it in another instantly. Code runs in a sandboxed Docker container; the result appears in everyone's output panel.

## Architecture

Three independent services:

- **Next.js app** — UI, auth, API routes (`/api/run`)
- **Hocuspocus WebSocket server** (`ws-server/`) — Yjs document sync for collaborative editing
- **Code execution service** (`exec-server/`) — sandboxed Python execution in disposable Docker containers

Database: Supabase Postgres with row-level security enforcing multi-tenant isolation at the database layer.

## Technical anchors

1. **CRDT-based collaborative editing** — Yjs for conflict-free merging, Tiptap for the notes editor, Monaco for the code editor (both bound via Yjs adapters). Hocuspocus holds the authoritative Y.Doc in memory per document and persists snapshots to Postgres on a debounce.

2. **Sandboxed code execution** — Disposable Docker container per run. Network disabled (`--network=none`), root filesystem read-only, 256MB memory cap, 64 PID limit, half-CPU quota, 10-second wall-clock timeout. All capabilities dropped, runs as an unprivileged user, default seccomp profile.

3. **Multi-tenant Postgres with RLS** — Every tenant-scoped query is gated by row-level security. The database, not application code, enforces who can see what. Includes a `SECURITY DEFINER` helper to avoid the RLS recursion trap on the `room_members` table.

4. **Real-time WebSocket engineering** — Custom Hocuspocus hooks for auth (validates the user's Supabase JWT and confirms room membership via RLS), document load/store, and document-type dispatch (`note:` vs `code:` URL prefix).

## Engineering notes

Some things that weren't obvious during the build:

- Policies on `room_members` that need to query `room_members` recursively trigger themselves. The fix is a `SECURITY DEFINER` function that bypasses RLS on its internal reads — used by every membership-check policy.

- `create_room` is a Postgres function (called via `supabase.rpc`) rather than two `.insert()` calls from the app. The function body is a single transaction, so the room insert and the owner-membership insert either both commit or both roll back — no orphan rooms with no members.

- Yjs `bytea` persistence corrupted on round-trip because the Supabase JS client serializes Buffer values as JSON when sent via PostgREST, storing `{"type":"Buffer","data":[...]}` as text bytes in the column. Fix: hex-encode the bytes to Postgres `bytea` text format (`\xDEADBEEF...`) on write. Reads via the SDK return the same format and the existing decoder handles it.

- Code session output (run results) is written into a shared `Y.Map` on the same Y.Doc as the code editor. When anyone clicks Run, the result lands in the map and Yjs syncs it to every connected peer. Same channel as the editor itself.

- The exec-server authenticates the Next.js app via a shared secret in a header. The comparison uses `crypto.timingSafeEqual` to avoid timing attacks. The exec-server never speaks to the database — it only runs code for its single trusted caller.

## Running locally

Requires: Node 20+, Docker, a Supabase project.

### 1. Supabase setup

Create a free Supabase project. In the SQL Editor, run each migration in order:

```
supabase/migrations/0001_initial_schema.sql
supabase/migrations/0002_create_room.sql
supabase/migrations/0003_join_room.sql
supabase/migrations/0004_yjs_snapshot.sql
supabase/migrations/0005_code_session_setup.sql
```

Paste each file's contents into the SQL Editor and run them one at a time. They are idempotent within reason but should be applied in order.

After running them, verify RLS is enabled on every table:

```sql
select relname, relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace
  and relkind = 'r';
```

All six tables should show `true`.

### 2. Environment variables

Copy each `.env.example` to its actual filename and fill in values from the Supabase dashboard (Project Settings → API):

```
cp .env.example .env.local
cp ws-server/.env.example ws-server/.env
cp exec-server/.env.example exec-server/.env
```

For `EXEC_SHARED_SECRET`, generate a long random hex string and use the same value in both `.env.local` and `exec-server/.env`:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Build the Docker sandbox image

```
cd exec-server
docker build -t nebula-python-sandbox:latest -f docker/python.Dockerfile docker/
```

Verify with `docker images | grep nebula-python-sandbox`.

### 4. Install and run the three services

Three terminals.

Terminal 1 — Hocuspocus:

```
cd ws-server
npm install
npm run dev
```

Wait for `Hocuspocus listening on ws://localhost:1234`.

Terminal 2 — code executor:

```
cd exec-server
npm install
npm run dev
```

Wait for `exec-server listening on http://localhost:4000`.

Terminal 3 — Next.js:

```
npm install
npm run dev
```

Open `http://localhost:3000`. Sign up two accounts (the second via incognito) to test the multi-user collaboration flow.

## File layout

```
.
├── src/                          Next.js app
│   ├── app/
│   │   ├── (app)/                Authenticated routes (route group)
│   │   │   ├── layout.tsx        Shared app navbar + auth check
│   │   │   ├── rooms/            Rooms list + create/join
│   │   │   └── room/[id]/        Single room: notes, code editor
│   │   ├── _landing/             Landing page components
│   │   ├── api/run/              Code execution route handler
│   │   ├── auth/callback/        OAuth/email confirm callback
│   │   ├── login/, signup/       Auth pages
│   │   └── page.tsx              Landing page
│   ├── lib/supabase/             Supabase SSR clients
│   └── middleware.ts             Session refresh + route protection
├── ws-server/                    Hocuspocus WebSocket server
│   └── src/server.ts             Auth, load, store hooks
├── exec-server/                  Docker-based code executor
│   ├── src/server.ts             HTTP API, sandbox flags
│   └── docker/python.Dockerfile  Sandboxed Python image
└── supabase/migrations/          Schema + RLS + RPCs
```