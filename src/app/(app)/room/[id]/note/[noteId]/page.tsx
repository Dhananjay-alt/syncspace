// src/app/room/[id]/note/[noteId]/page.tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { NoteEditor } from './note-editor'

export default async function NotePage({
  params,
}: {
  params: Promise<{ id: string; noteId: string }>
}) {
  const { id: roomId, noteId } = await params

  const supabase = await createClient()

  // ───────────────────────────────────────────────────────────────────
  // We need TWO things from Supabase here:
  //   1. The user's session — which carries the access_token we'll hand
  //      to the WebSocket. Note we use getUser() to VALIDATE the JWT
  //      (round-trips Supabase), then getSession() to get the token
  //      itself. getUser doesn't return the token; getSession does.
  //   2. The note metadata — to verify access (RLS) and show the title.
  // ───────────────────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    notFound() // middleware should have redirected; defense in depth
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) {
    notFound()
  }

  // Fetch the note. RLS gates this — if the user isn't a member of the
  // room, no row comes back, and we 404 (don't leak existence).
  const { data: note } = await supabase
    .from('notes')
    .select('id, title, room_id')
    .eq('id', noteId)
    .eq('room_id', roomId) // belt + braces; URL could be tampered
    .maybeSingle()

  if (!note) {
    notFound()
  }

  // Display name fallback. We pull from the profile if it has one, else
  // use the email's local-part. For the hackathon this is fine; in a
  // bigger app you'd surface a profile-edit flow.
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, email')
    .eq('id', user.id)
    .maybeSingle()

  const displayName =
    profile?.display_name ||
    profile?.email?.split('@')[0] ||
    'Anonymous'

  return (
    <main className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-3xl">
        <NoteEditor
          noteId={note.id}
          noteTitle={note.title}
          token={session.access_token}
          user={{ id: user.id, name: displayName }}
        />
      </div>
    </main>
  )
}