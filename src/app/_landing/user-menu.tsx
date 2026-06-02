// src/app/_landing/user-menu.tsx
'use client'

import Link from 'next/link'
import { LogOut, Layout } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { signout } from '../login/actions'

// Same color hash as in note-editor.tsx — consistent avatar colors for a
// user across the app. Could extract to a shared util later.
const COLORS = [
  '#f87171', '#fb923c', '#fbbf24', '#a3e635',
  '#34d399', '#22d3ee', '#60a5fa', '#a78bfa', '#f472b6',
]
function colorForUser(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0
  }
  return COLORS[Math.abs(hash) % COLORS.length]
}

export function UserMenu({
  userId,
  name,
  email,
}: {
  userId: string
  name: string
  email: string
}) {
  const initial = name.charAt(0).toUpperCase()
  const color = colorForUser(userId)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* The trigger is the avatar circle. asChild + button means Radix
            attaches its trigger behavior to OUR button instead of wrapping
            in its own — gives us full styling control. */}
        <button
          className="h-9 w-9 rounded-full flex items-center justify-center text-sm font-medium text-background hover:ring-2 hover:ring-border transition-all focus:outline-none focus:ring-2 focus:ring-foreground/40"
          style={{ backgroundColor: color }}
          aria-label="User menu"
        >
          {initial}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col">
            <span className="text-sm font-medium">{name}</span>
            <span className="text-xs text-muted-foreground truncate">
              {email}
            </span>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/rooms" className="cursor-pointer">
            <Layout className="mr-2 h-4 w-4" />
            Your rooms
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Sign out is a Server Action wrapped in a form. We use a form
            here (rather than onClick) so the action runs server-side with
            access to cookies — same pattern as login. The form's submit
            button is styled to look like a menu item. */}
        <form action={signout}>
          <button
            type="submit"
            className="relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground text-destructive"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}