// src/app/(app)/_components/app-nav.tsx
import Link from 'next/link'
import { UserMenu } from '@/app/_landing/user-menu'

// The shared in-app navbar. Mirrors the landing nav visually (same border,
// same brand position) so the transition from landing → app feels seamless,
// but trades the marketing CTAs for the user menu. Server Component since
// it's pure markup — interactive bits live inside UserMenu.

export function AppNav({
  userId,
  name,
  email,
}: {
  userId: string
  name: string
  email: string
}) {
  return (
    <nav className="border-b border-border/40 backdrop-blur-sm sticky top-0 z-40 bg-background/80">
      <div className="mx-auto max-w-6xl flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="font-semibold tracking-tight hover:text-foreground/80 transition-colors"
          >
            Tandem
          </Link>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link
              href="/rooms"
              className="hover:text-foreground transition-colors"
            >
              Rooms
            </Link>
          </div>
        </div>

        <UserMenu userId={userId} name={name} email={email} />
      </div>
    </nav>
  )
}