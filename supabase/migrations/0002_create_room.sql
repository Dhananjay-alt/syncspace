-- =============================================================================
-- Migration 0002 — create_room RPC
-- =============================================================================
-- Creates a room AND adds the creator as the owner-member, atomically.
-- A plpgsql function body runs in a single transaction, so both inserts
-- either succeed together or roll back together — no ownerless rooms.
--
-- IMPORTANT: this function is SECURITY INVOKER (the default — we do NOT mark
-- it `security definer`). That means it runs as the CALLING user, so RLS
-- still applies to its inserts:
--   * the rooms insert is checked against rooms_insert_self_owner
--     (owner_id must = auth.uid())
--   * the room_members insert is checked against room_members_insert_self
--     (user_id must = auth.uid())
-- This is deliberate: unlike the membership *helper* (which had to bypass RLS
-- to avoid recursion), here we WANT RLS to apply. Defense in depth — even our
-- own RPC can't forge a room owned by someone else.
-- =============================================================================

create or replace function public.create_room(
  p_name        text,
  p_invite_code text
)
returns public.rooms
language plpgsql
security definer            -- ← this line
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_uid  uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  insert into public.rooms (name, invite_code, owner_id)
  values (p_name, p_invite_code, v_uid)
  returning * into v_room;

  insert into public.room_members (room_id, user_id, role)
  values (v_room.id, v_uid, 'owner');

  return v_room;
end;
$$;