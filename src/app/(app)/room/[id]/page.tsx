// src/app/(app)/room/[id]/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { CreateNoteForm } from './create-note-form'
import { CodePanel } from './code-panel'
import { CopyInviteButton } from './copy-invite-button'
import { DeleteNoteMenu } from './delete-note-menu'


export default async function RoomPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: roomId } = await params

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) notFound()

  // Fetch the room. RLS gates this — if the user isn't a member, the
  // query returns no row and we 404 (don't leak existence).
  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('id, name, invite_code')
    .eq('id', roomId)
    .maybeSingle()
  if (roomError || !room) notFound()

  // Member count for the static "X members" badge in the header.
  // count: 'exact' + head: true returns the count without pulling the rows.
  const { count: memberCount } = await supabase
    .from('room_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('room_id', roomId)

  // Notes for this room.
  const { data: notes } = await supabase
    .from('notes')
    .select('id, title, updated_at')
    .eq('room_id', roomId)
    .order('updated_at', { ascending: false })

  // Auth session for the WS token used by the code panel.
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) notFound()

  // Idempotent get-or-create for the room's single code session.
  const { data: codeSessionRaw, error: csError } = await supabase
    .rpc('get_or_create_code_session', { p_room_id: room.id })
    .single()
  if (csError || !codeSessionRaw) {
    console.error('get_or_create_code_session failed', csError)
    notFound()
  }
  const codeSession = codeSessionRaw as unknown as { id: string }

  // Display name fallback for the user prop on collab components.
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, email')
    .eq('id', user.id)
    .maybeSingle()
  const displayName =
    profile?.display_name || profile?.email?.split('@')[0] || 'Anonymous'

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <Link
        href="/rooms"
        className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        ← All rooms
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-10 pb-6 border-b border-border/40">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight truncate">
            {room.name}
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {memberCount ?? 0} {memberCount === 1 ? 'member' : 'members'}
          </p>
        </div>
        <CopyInviteButton inviteCode={room.invite_code} />
      </div>

      <div className="space-y-12">
        <section>
          <div className="mb-4">
            <h2 className="text-sm font-medium">Notes</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Shared documents for this room
            </p>
          </div>

          <div className="mb-4">
            <CreateNoteForm roomId={room.id} />
          </div>

          {notes && notes.length > 0 ? (
            <ul className="space-y-2">
              {notes.map((note) => (
                <li key={note.id} className="group relative">
  <Link
    href={`/room/${room.id}/note/${note.id}`}
    className="flex items-center justify-between rounded-lg border border-border/60 bg-card/40 p-4 hover:border-border hover:bg-card/80 transition-colors"
  >
    <div className="min-w-0 flex-1">
      <p className="font-medium truncate group-hover:text-foreground">
        {note.title}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        Updated {new Date(note.updated_at).toLocaleString()}
      </p>
    </div>
    <span className="ml-4 text-muted-foreground group-hover:text-foreground transition-colors">
      →
    </span>
  </Link>
  {/* Delete menu positioned absolutely on top of the card.
      Hidden by default, revealed on group hover via the menu's own
      opacity-0 group-hover:opacity-100. */}
  <div className="absolute right-12 top-1/2 -translate-y-1/2">
    <DeleteNoteMenu
      noteId={note.id}
      roomId={room.id}
      noteTitle={note.title}
    />
  </div>
</li>
              ))}
            </ul>
          ) : (
            <div className="rounded-lg border border-dashed border-border/60 p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No notes yet. Create one above ↑
              </p>
            </div>
          )}
        </section>

        <section>
          <CodePanel
            roomId={room.id}
            codeSessionId={codeSession.id}
            token={session.access_token}
            user={{ id: user.id, name: displayName }}
          />
        </section>
      </div>
    </main>
  )
}