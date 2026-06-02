// src/app/(app)/rooms/page.tsx
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { CreateRoomForm } from './create-room-form'
import { JoinRoomForm } from './join-room-form'

export default async function RoomsPage() {
  const supabase = await createClient()

  // Same RLS-gated query as before — only returns rooms the user is a
  // member of, automatically.
  const { data: rooms } = await supabase
    .from('rooms')
    .select('id, name, invite_code, created_at')
    .order('created_at', { ascending: false })

  const roomCount = rooms?.length ?? 0

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      {/* Page header — informative, calmer than a "title + subtitle" stack */}
      <div className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight">Rooms</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {roomCount === 0
            ? 'Create your first room or join one with an invite code.'
            : `${roomCount} ${roomCount === 1 ? 'room' : 'rooms'}`}
        </p>
      </div>

      {/* Create + Join in a side-by-side card layout. Each gets its own
          card so they read as separate actions, not a stacked form. */}
      <div className="grid md:grid-cols-2 gap-4 mb-10">
        <div className="rounded-xl border border-border/60 bg-card/50 p-5">
          <div className="mb-3">
            <h2 className="text-sm font-medium">Create a room</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Start a new study session
            </p>
          </div>
          <CreateRoomForm />
        </div>

        <div className="rounded-xl border border-border/60 bg-card/50 p-5">
          <div className="mb-3">
            <h2 className="text-sm font-medium">Join with a code</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Enter an invite code to join
            </p>
          </div>
          <JoinRoomForm />
        </div>
      </div>

      {/* Room list */}
      <div>
        {rooms && rooms.length > 0 ? (
          <div className="space-y-2">
            {rooms.map((room) => (
              <Link
                key={room.id}
                href={`/room/${room.id}`}
                // Card hover: subtle lift via border brightening. Avoids
                // transforms which can feel jittery on retina displays.
                className="group flex items-center justify-between rounded-lg border border-border/60 bg-card/40 p-4 hover:border-border hover:bg-card/80 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate group-hover:text-foreground">
                    {room.name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Created {new Date(room.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="ml-4 flex items-center gap-3">
                  <span className="text-xs text-muted-foreground font-mono">
                    {room.invite_code}
                  </span>
                  <span className="text-muted-foreground group-hover:text-foreground transition-colors">
                    →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          // Empty state: warm, encouraging. The arrow is purely decorative —
          // points back up to the create form to indicate "do this first."
          <div className="rounded-xl border border-dashed border-border/60 p-12 text-center">
            <p className="text-sm text-muted-foreground">
              No rooms yet. Create one above to get started ↑
            </p>
          </div>
        )}
      </div>
    </main>
  )
}