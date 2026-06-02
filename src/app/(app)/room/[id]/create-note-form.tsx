// src/app/room/[id]/create-note-form.tsx
'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { createNote } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Creating…' : 'New note'}
    </Button>
  )
}

export function CreateNoteForm({ roomId }: { roomId: string }) {
  // .bind() partially applies the server action: it pre-fills `roomId` as
  // the first argument, leaving the standard (prevState, formData) shape
  // that useActionState expects.
  //
  // Why bind instead of a hidden input field with roomId? Because the
  // bound arg is closed over server-side — the client can't tamper with
  // it. A hidden <input name="room_id" value={roomId}> would let a user
  // edit DevTools and submit a different room ID. RLS would still block
  // it, but bind is the cleaner default.
  const boundAction = createNote.bind(null, roomId)
  const [state, formAction] = useActionState(boundAction, null)

  return (
    <form action={formAction} className="flex items-start gap-2">
      <div className="flex-1 space-y-2">
        <Input
          name="title"
          placeholder="Note title (optional)"
          maxLength={200}
        />
        {state?.error && (
          <p className="text-sm text-destructive" role="alert">
            {state.error}
          </p>
        )}
      </div>
      <SubmitButton />
    </form>
  )
}