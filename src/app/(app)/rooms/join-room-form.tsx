'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { joinRoom } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? 'Joining…' : 'Join'}
    </Button>
  )
}

export function JoinRoomForm() {
  const [state, formAction] = useActionState(joinRoom, null)

  return (
    <form action={formAction} className="flex items-start gap-2">
      <div className="flex-1 space-y-2">
        <Input
          name="invite_code"
          placeholder="Enter invite code"
          required
          // Visually hint that codes are uppercase; the action normalizes
          // anyway, but this reduces user confusion.
          className="font-mono uppercase placeholder:font-sans placeholder:normal-case"
          maxLength={8}
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