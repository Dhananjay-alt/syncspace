// src/app/room/[id]/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { CreateNoteForm } from './create-note-form'
import { CodePanel } from './code-panel'  

export default async function RoomPage({
  params,
}: {
  // Next 15: params is a Promise
  params: Promise<{ id: string }>
}) {
  const { id: roomId } = await params

  const supabase = await createClient()


  const {
  data: { user },
} = await supabase.auth.getUser()
if (!user) notFound()
  // Fetch the room. RLS does the work: if the user isn't a member of this
  // room, this returns no row, and we show a 404 — which is the right
  // behavior (we don't want to reveal "this room exists but you can't see
  // it" vs "this room doesn't exist"). Tenancy as a side effect of the
  // policy, not as an `if` statement in our code.
  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('id, name, invite_code')
    .eq('id', roomId)
    .maybeSingle()

  if (roomError || !room) {
    notFound()
  }

  // Fetch the notes for this room. Same story — RLS already constrains us
  // to notes whose room_id is one we're a member of. Belt and braces, we
  // also filter explicitly, because (a) it's cheaper than scanning all
  // notes the user can see, and (b) it makes the intent clear in the code.
  const { data: notes } = await supabase
    .from('notes')
    .select('id, title, updated_at')
    .eq('room_id', roomId)
    .order('updated_at', { ascending: false })

  // Auth session for the WS token (same as note page).
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) {
    notFound()
  }

  // Get-or-create the room's single code session. Idempotent — running this
  // every page load is fine because the RPC uses INSERT ... ON CONFLICT.
  const { data: codeSession, error: csError } = await supabase
    .rpc('get_or_create_code_session', { p_room_id: room.id })
    .single()

  if (csError || !codeSession) {
    console.error('get_or_create_code_session failed', csError)
    notFound()
  }

  // Display name fallback for awareness/run-attribution.
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, email')
    .eq('id', user.id)
    .maybeSingle()
  const displayName =
    profile?.display_name || profile?.email?.split('@')[0] || 'Anonymous'

  return (
    <main className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-3xl space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {room.name}
            </h1>
            <p className="text-xs text-muted-foreground">
              Invite code:{' '}
              <span className="font-mono">{room.invite_code}</span>
            </p>
          </div>
          {/* Presence pills will live here later — placeholder for now */}
          <div className="text-xs text-muted-foreground">
            Presence coming soon
          </div>
        </div>

        <section className="space-y-3">
          <h2 className="text-sm font-medium">Create a note</h2>
          <CreateNoteForm roomId={room.id} />
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-medium">Notes</h2>
          {notes && notes.length > 0 ? (
            <ul className="space-y-2">
              {notes.map((note) => (
                <li key={note.id}>
                  <Link
                    href={`/room/${room.id}/note/${note.id}`}
                    className="block rounded-lg border border-border bg-card p-4 hover:bg-accent transition-colors"
                  >
                    <p className="font-medium">{note.title}</p>
                    <p className="text-xs text-muted-foreground">
                      Updated {new Date(note.updated_at).toLocaleString()}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No notes yet. Create one above.
            </p>
          )}
        </section>

        <CodePanel
          roomId={room.id}
          codeSessionId={codeSession.id}
          token={session.access_token}
          user={{ id: user.id, name: displayName }}
        />
      </div>
    </main>
  )
}