import { createClient } from '@/lib/supabase/server'
import { CreateRoomForm } from './create-room-form'
import { JoinRoomForm } from './join-room-form'

export default async function RoomsPage() {
  const supabase = await createClient()

  // ────────────────────────────────────────────────────────────────────
  // THE RLS PAYOFF — look closely at this query.
  //
  // We select ALL rooms with NO permission filter. No `where owner_id = ...`,
  // no `where I am a member`. Just "give me the rooms."
  //
  // Yet this only returns rooms the current user is a MEMBER of. Why?
  // Because the `rooms_select_members` RLS policy runs inside Postgres on
  // every row and silently drops the ones where is_room_member(id) is false.
  //
  // The security is in the database, not here. If you forgot to write this
  // comment's logic in your app, it would STILL be safe. That's the whole
  // point of RLS. This is the thing to show and explain to judges.
  // ────────────────────────────────────────────────────────────────────
  const { data: rooms, error } = await supabase
    .from('rooms')
    .select('id, name, invite_code, created_at')
    .order('created_at', { ascending: false })

  return (
    <main className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-2xl space-y-8">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Your rooms</h1>
          <p className="text-sm text-muted-foreground">
            Create a room or join one with an invite code.
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Create a room</p>
            <CreateRoomForm />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Join a room</p>
            <JoinRoomForm />
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            Failed to load rooms: {error.message}
          </p>
        )}

        <div className="space-y-2">
          {rooms && rooms.length > 0 ? (
            rooms.map((room) => (
              <div
                key={room.id}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-4"
              >
                <div>
                  <p className="font-medium">{room.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Code: <span className="font-mono">{room.invite_code}</span>
                  </p>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No rooms yet. Create your first one above.
            </p>
          )}
        </div>
      </div>
    </main>
  )
}