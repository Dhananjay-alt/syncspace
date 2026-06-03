-- =============================================================================
-- Migration 0004 — Yjs persistence: switch from append log to snapshot
-- =============================================================================
-- We've chosen Hocuspocus as the WS server. Hocuspocus's hook model hands us
-- the fully-merged Y.Doc on store, which naturally matches a single-blob
-- snapshot. With a single stateful server instance, the in-memory Y.Doc is
-- the live authority; the DB's only job is durability between sessions.
-- A snapshot is correct for that shape — the append log was designed for a
-- multi-writer scenario we don't have.
-- =============================================================================

-- Drop the append-only log we built earlier — unused under this strategy.
drop table if exists public.note_updates;

-- Add a single snapshot column. `bytea` is Postgres's binary type; we'll
-- store `Y.encodeStateAsUpdate(doc)` here — the entire current document
-- state in Yjs's compact binary format.
--
-- Nullable: a freshly-created note has no content yet, so the snapshot is
-- NULL until the first save. Hocuspocus's onLoadDocument must handle NULL
-- by returning an empty doc.
alter table public.notes
  add column ydoc_state bytea;