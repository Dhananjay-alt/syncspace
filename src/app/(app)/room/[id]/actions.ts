'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type CreateNoteState = {
  error: string | null
} | null

export async function createNote(
  roomId: string,
  _prevState: CreateNoteState,
  formData: FormData
): Promise<CreateNoteState> {
  const rawTitle = formData.get('title')
  const title =
    typeof rawTitle === 'string' && rawTitle.trim().length > 0
      ? rawTitle.trim().slice(0, 200)
      : 'Untitled'

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'You must be signed in.' }
  }

  // Plain insert. No `where`-style permission filter is needed: the
  // `notes_insert_members` RLS policy will reject this insert if the user
  // isn't a member of `room_id`. The database is the gate; this code
  // doesn't even mention "is the user in this room?"
  const { error } = await supabase.from('notes').insert({
    room_id: roomId,
    title,
    created_by: user.id,
  })

  if (error) {
    // 42501 = insufficient_privilege = RLS rejection. If the user is somehow
    // trying to create a note in a room they don't belong to, this is what
    // they'd see. Treat it as a generic permission error to avoid leaking
    // whether the room exists.
    if (error.code === '42501') {
      return { error: 'You do not have access to this room.' }
    }
    console.error('createNote failed:', error)
    return { error: 'Could not create note. Please try again.' }
  }

  revalidatePath(`/room/${roomId}`)
  return null
}

export type DeleteNoteState = {
  error: string | null
} | null

export async function deleteNote(noteId: string, roomId: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'You must be signed in.' }
  }

  // No explicit membership check needed — the notes_delete_members RLS
  // policy enforces it at the database. If the user isn't a member of
  // the room owning this note, the delete returns 0 rows affected and
  // we treat it as "not authorized" (RLS hides the row).
  //
  // We pass roomId only to scope the delete to the URL-claimed room, as
  // belt + braces against a tampered URL.
  const { error } = await supabase
    .from('notes')
    .delete()
    .eq('id', noteId)
    .eq('room_id', roomId)

  if (error) {
    if (error.code === '42501') {
      return { error: 'You do not have access to this note.' }
    }
    console.error('deleteNote failed:', error)
    return { error: 'Could not delete note. Please try again.' }
  }

  revalidatePath(`/room/${roomId}`)
  return null
}