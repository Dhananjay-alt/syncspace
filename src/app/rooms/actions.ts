'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { generateInviteCode } from '@/lib/invite-code'

export type CreateRoomState = {
  error: string | null
} | null

export async function createRoom(
  _prevState: CreateRoomState,
  formData: FormData
): Promise<CreateRoomState> {
  const name = formData.get('name')

  if (typeof name !== 'string' || name.trim().length === 0) {
    return { error: 'Room name is required.' }
  }
  if (name.length > 100) {
    return { error: 'Room name must be 100 characters or fewer.' }
  }

  const supabase = await createClient()

  // Defense in depth: middleware already gates this, but an action can be
  // invoked directly, so we re-check auth here. Never trust the caller.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'You must be signed in to create a room.' }
  }

  // Retry loop for the (very rare) invite-code collision. The DB's UNIQUE
  // constraint will reject a duplicate code; if that happens we generate a
  // new one and try again. 5 attempts is overkill given the odds.
  const MAX_ATTEMPTS = 5
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const inviteCode = generateInviteCode()

    // Call the atomic RPC. Both the room and the owner-membership are
    // inserted in one transaction inside Postgres.
    const { data, error } = await supabase.rpc('create_room', {
      p_name: name.trim(),
      p_invite_code: inviteCode,
    })

    if (!error) {
      // Success. Refresh the rooms list (Server Component cache) so the new
      // room appears immediately.
      revalidatePath('/rooms')
      return null
    }

    // Postgres unique-violation error code is '23505'. If that's what we hit,
    // it's a code collision — loop and try a fresh code. Any other error is
    // real and we surface it.
    if (error.code !== '23505') {
      // Don't leak raw DB errors to users in general; here it's fine for a
      // hackathon, but in prod you'd log `error` server-side and return a
      // generic message.
      console.error('create_room failed:', error)
      return { error: 'Could not create room. Please try again.' }
    }
    // else: collision, continue the loop with a new code
  }

  return { error: 'Could not generate a unique room code. Please try again.' }
}

export type JoinRoomState = {
  error: string | null
} | null

export async function joinRoom(
  _prevState: JoinRoomState,
  formData: FormData
): Promise<JoinRoomState> {
  const rawCode = formData.get('invite_code')

  if (typeof rawCode !== 'string' || rawCode.trim().length === 0) {
    return { error: 'Invite code is required.' }
  }

  // Normalize: our codes are uppercase, and people will paste with stray
  // whitespace or in lowercase. Match the generator's alphabet conditions.
  const inviteCode = rawCode.trim().toUpperCase()

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'You must be signed in to join a room.' }
  }

  const { error } = await supabase.rpc('join_room', {
    p_invite_code: inviteCode,
  })

  if (error) {
    // P0002 is our "invalid invite code" sentinel from the function.
    if (error.code === 'P0002') {
      return { error: 'No room found with that code.' }
    }
    console.error('join_room failed:', error)
    return { error: 'Could not join room. Please try again.' }
  }

  // The user is now a member, so the rooms list query will include this
  // room. Refresh the cached Server Component.
  revalidatePath('/rooms')
  return null
}