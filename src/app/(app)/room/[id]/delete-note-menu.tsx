'use client'

import { useState, useTransition } from 'react'
import { MoreVertical, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { deleteNote } from './actions'

export function DeleteNoteMenu({
  noteId,
  roomId,
  noteTitle,
}: {
  noteId: string
  roomId: string
  noteTitle: string
}) {
  // Two-step destructive UI: first the kebab opens a small menu, then
  // clicking "Delete" opens a confirm dialog. Two layers of friction so
  // accidents don't nuke shared content.
  const [confirmOpen, setConfirmOpen] = useState(false)
  // useTransition gives us a "pending" flag during the async server action
  // without managing our own loading state — and keeps the UI responsive.
  const [pending, startTransition] = useTransition()

  function handleConfirmDelete() {
    startTransition(async () => {
      const result = await deleteNote(noteId, roomId)
      if (result?.error) {
        // For brevity we just alert — could be a toast later.
        alert(result.error)
      }
      setConfirmOpen(false)
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            // stopPropagation: the card itself is a <Link>; without this,
            // clicking the kebab would also navigate into the note.
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-card transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
            aria-label="Note actions"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(e) => {
              // Same stopPropagation reasoning — don't let the select event
              // bubble up and navigate into the note.
              e.preventDefault()
              setConfirmOpen(true)
            }}
            className="text-destructive focus:text-destructive cursor-pointer"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete note
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete note?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{' '}
              <span className="font-medium text-foreground">
                &ldquo;{noteTitle}&rdquo;
              </span>{' '}
              and all its content. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleConfirmDelete()
              }}
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}