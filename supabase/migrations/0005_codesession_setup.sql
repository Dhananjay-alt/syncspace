-- =============================================================================
-- Migration 0005 — code_sessions.ydoc_state
-- =============================================================================
-- Mirrors notes.ydoc_state. Lets us collaborate on the shared code editor
-- using the same Hocuspocus + Yjs snapshot model. Not used by Tier 1 (the
-- editor will still be plain React state this turn), but adding now means
-- the schema is ready when we wire collab next turn.
-- =============================================================================

alter table public.code_sessions
  add column ydoc_state bytea;

-- A small helper RPC to "get or create" the code session for a room.
-- Why an RPC instead of two queries in the app: select-then-insert from the
-- app has a race window where two users opening the room simultaneously
-- could each insert and one would fail on the UNIQUE (room_id) constraint.
-- Doing it in a function uses Postgres's ON CONFLICT atomically.
--
-- SECURITY DEFINER for the same reason as create_room: the function is the
-- security boundary, capability is "get/create the code session for a room
-- I'm a member of", and we check membership ourselves.
create or replace function public.get_or_create_code_session(p_room_id uuid)
returns public.code_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.code_sessions;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Enforce membership ourselves since we're bypassing RLS. This is the
  -- "function is the boundary" pattern in action.
  if not public.is_room_member(p_room_id) then
    raise exception 'Not a member of this room' using errcode = '42501';
  end if;

  -- Try to find existing session; if absent, create one.
  -- Using ON CONFLICT makes the upsert race-safe under concurrent callers.
  insert into public.code_sessions (room_id, language, source)
  values (p_room_id, 'python', '')
  on conflict (room_id) do nothing;

  select * into v_session
  from public.code_sessions
  where room_id = p_room_id;

  return v_session;
end;
$$;