'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { createRoom } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Creating…' : 'Create room'}
    </Button>
  )
}

export function CreateRoomForm() {
  const [state, formAction] = useActionState(createRoom, null)

  return (
    <form action={formAction} className="flex items-start gap-2">
      <div className="flex-1 space-y-2">
        <Input
          name="name"
          placeholder="e.g. CS Algorithms Study Group"
          required
          maxLength={100}
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