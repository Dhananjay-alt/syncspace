# SyncSpace

Real-time collaborative study workspace built for the Nebula competition (MDG Space, IIT Roorkee).

## Features

- Real-time collaborative notes (Yjs CRDTs + Tiptap)
- Shared Python code editor (Yjs + Monaco)
- Sandboxed code execution with shared output (Docker)
- Multi-tenant rooms with invite codes
- Authentication via Supabase

## Architecture

Three independent services:

- **Next.js app** — UI, auth, API routes
- **Hocuspocus WebSocket server** (`ws-server/`) — real-time collaboration via Yjs
- **Exec-server** (`exec-server/`) — sandboxed Docker code execution

Database: Supabase Postgres with row-level security enforcing tenant isolation at the database layer.

## Technical anchors

1. **CRDT-based collaborative editing** — Yjs for conflict-free document merging, Hocuspocus for stateful WebSocket sync, snapshot persistence to Postgres.
2. **Sandboxed code execution** — Disposable Docker containers per run with `--network=none`, `--read-only`, memory/CPU/PID limits, wall-clock timeout, and dropped capabilities.
3. **Multi-tenant Postgres with RLS** — Every tenant-scoped query gated by row-level security; the database, not application code, enforces isolation.
4. **Real-time WebSocket engineering** — Custom Hocuspocus hooks for auth (validates JWT + RLS-checked membership), document load/store, and awareness routing.

## Running locally

Requirements: Node 20+, Docker, a Supabase project.

```bash
# Apply migrations (in Supabase SQL Editor): supabase/migrations/0001 through 0005

# Set env vars (see .env.example in each project)

# Build the Docker sandbox image
cd exec-server && docker build -t nebula-python-sandbox:latest -f docker/python.Dockerfile docker/

# Run all three services
cd ws-server && npm install && npm run dev
cd exec-server && npm install && npm run dev
cd ../ && npm install && npm run dev
```

Built solo in 5 days.