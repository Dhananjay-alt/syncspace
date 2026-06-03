-- =============================================================================
-- Nebula Study Workspace — initial schema + RLS
-- =============================================================================
-- Design notes:
--   * `profiles` mirrors auth.users 1:1, populated by a trigger on signup.
--   * `room_members` is the junction table; nearly every RLS policy reduces
--     to "does a row exist in room_members for (this user, this room)?".
--   * Membership checks go through a SECURITY DEFINER function to avoid the
--     infinite-recursion trap in RLS (explained inline at the function).
--   * `note_updates` is an append-only Yjs update log (CRDT-honest design).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. PROFILES
-- -----------------------------------------------------------------------------
-- We cannot attach foreign keys or RLS-friendly policies directly against
-- auth.users (it lives in a protected schema). The standard Supabase pattern
-- is a public.profiles table keyed by the same UUID, kept in sync via trigger.

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  display_name text,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Anyone authenticated can read profiles (needed to show "who's in the room",
-- author names on notes, etc.). We deliberately do NOT expose this to anon.
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- A user may update only their own profile row.
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Note: there is intentionally NO insert policy for users. Profiles are
-- created by the trigger below, which runs as SECURITY DEFINER and bypasses
-- RLS. Users never insert their own profile directly.


-- -----------------------------------------------------------------------------
-- 2. TRIGGER: auto-create a profile when a user signs up
-- -----------------------------------------------------------------------------
-- This fires on every new auth.users row. SECURITY DEFINER means it runs with
-- the privileges of the function owner (postgres), so it can insert into
-- profiles regardless of RLS. We pull display_name/avatar from the OAuth
-- metadata if present (Google provides these), else fall back to null.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''   -- hardening: prevent search_path hijacking, see note
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;
-- Why `set search_path = ''`: a SECURITY DEFINER function runs with elevated
-- privileges. If search_path is attacker-controllable, someone could shadow
-- `public.profiles` with a malicious table on their own search_path and have
-- our privileged function write there. Pinning search_path to empty and fully
-- qualifying every name (public.profiles) closes that hole. This is a real
-- Postgres security best practice, not paranoia.

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- -----------------------------------------------------------------------------
-- 3. ROOMS
-- -----------------------------------------------------------------------------

create table public.rooms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 100),
  -- invite_code is the join token, also used for the shareable link
  -- (/join/<invite_code>). Short, URL-safe, unique. We generate it in the
  -- app layer (more control over alphabet) but enforce uniqueness here.
  invite_code text not null unique,
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);

alter table public.rooms enable row level security;

-- Index the invite_code since we look rooms up by it on every join.
create index rooms_invite_code_idx on public.rooms (invite_code);
create index rooms_owner_id_idx on public.rooms (owner_id);


-- -----------------------------------------------------------------------------
-- 4. ROOM_MEMBERS (the heart of multi-tenancy)
-- -----------------------------------------------------------------------------

create type public.room_role as enum ('owner', 'member');

create table public.room_members (
  room_id   uuid not null references public.rooms (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      public.room_role not null default 'member',
  joined_at timestamptz not null default now(),
  -- Composite PK: a user can be in a room at most once. Also gives us a
  -- fast index for the membership lookups every policy performs.
  primary key (room_id, user_id)
);

alter table public.room_members enable row level security;

-- Reverse-direction index: "what rooms is this user in?" is a common query
-- (the rooms list). The PK covers (room_id, user_id); we add (user_id) for
-- the other access pattern.
create index room_members_user_id_idx on public.room_members (user_id);


-- -----------------------------------------------------------------------------
-- 5. THE MEMBERSHIP HELPER — and why it MUST be SECURITY DEFINER
-- -----------------------------------------------------------------------------
-- THE RECURSION TRAP (interview gold, read carefully):
--
-- We want a policy on `notes` like: "you can read a note if you're a member
-- of its room." The natural way is a subquery:
--     exists (select 1 from room_members
--             where room_id = notes.room_id and user_id = auth.uid())
--
-- That works for notes. But now consider a policy ON room_members itself:
-- "you can see members of rooms you belong to." Naively:
--     using ( exists (select 1 from room_members m
--                     where m.room_id = room_members.room_id
--                       and m.user_id = auth.uid()) )
-- To evaluate the policy on room_members, Postgres must query room_members,
-- which triggers the policy again, which queries room_members again... =>
-- "infinite recursion detected in policy for relation room_members".
--
-- THE FIX: a SECURITY DEFINER function. It runs as the owner and BYPASSES
-- RLS on the tables it reads, so querying room_members inside it does NOT
-- re-trigger the policy. We use this function everywhere we need a
-- membership check, including in the room_members policy itself.

create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable                         -- result is stable within a single statement;
                               -- lets the planner cache it per row-batch
as $$
  select exists (
    select 1
    from public.room_members
    where room_id = p_room_id
      and user_id = auth.uid()
  );
$$;

-- A second helper for owner-only actions (rename/delete room, kick members).
create or replace function public.is_room_owner(p_room_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.room_members
    where room_id = p_room_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;


-- -----------------------------------------------------------------------------
-- 6. RLS POLICIES: ROOMS
-- -----------------------------------------------------------------------------

-- SELECT: you can see a room if you're a member of it.
create policy "rooms_select_members"
  on public.rooms for select
  to authenticated
  using ( public.is_room_member(id) );

-- INSERT: any authenticated user can create a room. The check ensures they
-- can only create rooms they own (can't forge owner_id to someone else).
create policy "rooms_insert_self_owner"
  on public.rooms for insert
  to authenticated
  with check ( owner_id = auth.uid() );

-- UPDATE: only the owner can modify a room (rename, etc.).
create policy "rooms_update_owner"
  on public.rooms for update
  to authenticated
  using ( public.is_room_owner(id) )
  with check ( public.is_room_owner(id) );

-- DELETE: only the owner can delete a room.
create policy "rooms_delete_owner"
  on public.rooms for delete
  to authenticated
  using ( public.is_room_owner(id) );


-- -----------------------------------------------------------------------------
-- 7. RLS POLICIES: ROOM_MEMBERS
-- -----------------------------------------------------------------------------

-- SELECT: you can see the member list of any room you belong to.
-- Uses the SECURITY DEFINER helper to avoid the recursion trap above.
create policy "room_members_select_co_members"
  on public.room_members for select
  to authenticated
  using ( public.is_room_member(room_id) );

-- INSERT: this is the "join a room" action. A user may insert ONLY a row
-- for themselves (user_id = auth.uid()). They cannot add other people.
-- NOTE: this policy lets a user insert themselves into ANY room if they know
-- the room_id. That's too loose on its own — we gate joining behind knowing
-- the invite_code, which is enforced in the application layer (the join
-- action looks up the room by invite_code first). The DB policy is the
-- backstop: you can only ever add YOURSELF, never others.
create policy "room_members_insert_self"
  on public.room_members for insert
  to authenticated
  with check ( user_id = auth.uid() );

-- DELETE: you can remove yourself (leave a room), OR the owner can remove
-- anyone (kick). Owners cannot be removed by non-owners.
create policy "room_members_delete_self_or_owner"
  on public.room_members for delete
  to authenticated
  using (
    user_id = auth.uid()                  -- leave
    or public.is_room_owner(room_id)      -- kick (owner only)
  );

-- We intentionally omit an UPDATE policy (no role changes in v1).


-- -----------------------------------------------------------------------------
-- 8. NOTES
-- -----------------------------------------------------------------------------

create table public.notes (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms (id) on delete cascade,
  title      text not null default 'Untitled' check (char_length(title) <= 200),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notes enable row level security;
create index notes_room_id_idx on public.notes (room_id);

-- All note access is gated on room membership.
create policy "notes_select_members"
  on public.notes for select
  to authenticated
  using ( public.is_room_member(room_id) );

create policy "notes_insert_members"
  on public.notes for insert
  to authenticated
  with check ( public.is_room_member(room_id) );

create policy "notes_update_members"
  on public.notes for update
  to authenticated
  using ( public.is_room_member(room_id) )
  with check ( public.is_room_member(room_id) );

create policy "notes_delete_members"
  on public.notes for delete
  to authenticated
  using ( public.is_room_member(room_id) );


-- -----------------------------------------------------------------------------
-- 9. NOTE_UPDATES (append-only Yjs update log)
-- -----------------------------------------------------------------------------
-- Each row is one Yjs update (binary). To reconstruct a document, read all
-- rows for a note ordered by seq and apply them. `is_snapshot` marks a
-- compacted row (merge of many updates) so compaction can delete the
-- superseded rows and keep load times bounded.

create table public.note_updates (
  id          bigint generated always as identity primary key,
  note_id     uuid not null references public.notes (id) on delete cascade,
  -- The actual Yjs update payload. bytea is Postgres's binary type.
  update_data bytea not null,
  is_snapshot boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table public.note_updates enable row level security;

-- Composite index for the load query: "all updates for note X, in order."
create index note_updates_note_id_id_idx
  on public.note_updates (note_id, id);

-- Access gated on membership in the note's room. We join through notes to
-- get the room_id. This subquery is fine (notes has its own RLS but the
-- helper bypasses it). We check membership of the room that owns the note.
create policy "note_updates_select_members"
  on public.note_updates for select
  to authenticated
  using (
    public.is_room_member(
      (select room_id from public.notes where id = note_id)
    )
  );

create policy "note_updates_insert_members"
  on public.note_updates for insert
  to authenticated
  with check (
    public.is_room_member(
      (select room_id from public.notes where id = note_id)
    )
  );

-- No update/delete policies for normal users: the log is append-only.
-- Compaction is performed by the WS server using the service_role key,
-- which bypasses RLS entirely. Normal clients can never mutate history.


-- -----------------------------------------------------------------------------
-- 10. CODE_SESSIONS
-- -----------------------------------------------------------------------------
-- One per room for v1 (the shared code editor). Holds language + current
-- source. If we Yjs-sync the editor too, source becomes a note_updates-style
-- log; for now a simple text column is enough and we can upgrade later.

create table public.code_sessions (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms (id) on delete cascade,
  language   text not null default 'python'
               check (language in ('python', 'javascript', 'cpp')),
  source     text not null default '',
  updated_at timestamptz not null default now(),
  unique (room_id)   -- one code session per room in v1
);

alter table public.code_sessions enable row level security;

create policy "code_sessions_select_members"
  on public.code_sessions for select
  to authenticated
  using ( public.is_room_member(room_id) );

create policy "code_sessions_insert_members"
  on public.code_sessions for insert
  to authenticated
  with check ( public.is_room_member(room_id) );

create policy "code_sessions_update_members"
  on public.code_sessions for update
  to authenticated
  using ( public.is_room_member(room_id) )
  with check ( public.is_room_member(room_id) );