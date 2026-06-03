-- =============================================================================
-- Migration 0003 — join_room RPC
-- =============================================================================
-- Lets a user join a room by its invite code.
--
-- THE RLS PUZZLE this solves:
--   A non-member cannot SELECT a room (rooms_select_members policy), so they
--   can't look it up by invite_code to join it. Chicken-and-egg. We break it
--   with a SECURITY DEFINER function that bypasses RLS to FIND the room, then
--   adds the caller as a member.
--
-- WHY IT'S SAFE despite bypassing RLS:
--   * The caller controls ONLY the invite_code (a secret capability).
--   * The function adds ONLY auth.uid() — the caller can never add anyone else.
--   * If the code matches no room, it raises (no info leak about which codes
--     exist beyond "valid / invalid").
--   * If already a member, it's a no-op success (idempotent) rather than an
--     error — re-joining via a shared link shouldn't explode.
-- The granted capability is exactly "add myself to a room whose code I know",
-- which is precisely the intended join semantics.
-- =============================================================================

create or replace function public.join_room(p_invite_code text)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_uid  uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Find the room by code. SECURITY DEFINER means this read bypasses RLS,
  -- so it works even though the caller isn't a member yet.
  select * into v_room
  from public.rooms
  where invite_code = p_invite_code;

  -- No room with that code → generic "not found". We do NOT distinguish
  -- "no such code" from other failures, to avoid leaking which codes exist.
  if v_room.id is null then
    raise exception 'Invalid invite code' using errcode = 'P0002';
  end if;

  -- Add the caller as a member. ON CONFLICT makes re-joining idempotent:
  -- if they're already in the room (e.g. clicked the share link twice),
  -- we silently succeed instead of throwing a duplicate-key error.
  insert into public.room_members (room_id, user_id, role)
  values (v_room.id, v_uid, 'member')
  on conflict (room_id, user_id) do nothing;

  return v_room;
end;
$$;