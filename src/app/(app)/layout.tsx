// src/app/(app)/layout.tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppNav } from './_components/app-nav'

// This layout wraps every page inside (app)/ — meaning /rooms and /room/[id].
// It runs auth here ONCE so each child page doesn't need to re-fetch the user
// just to render the nav. The user blob also flows into AppNav for the menu.
//
// Why a layout (not middleware) for this:
//   - Layouts can fetch data and pass it to children/components.
//   - Middleware runs on every request including assets and is the wrong
//     place to do a Supabase round-trip per request.
// Middleware already handles "redirect if logged out" via your existing
// matcher rules; this layout is for the UI shell.

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Defense in depth: middleware should have caught this, but if a layout
  // renders without a user we'd crash on .id below. Belt + suspenders.
  if (!user) {
    redirect('/login')
  }

  // Resolve a display name + email for the user menu. Same fallback chain
  // as the landing page — keeps the user's identity consistent across views.
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, email')
    .eq('id', user.id)
    .maybeSingle()

  const displayName =
    profile?.display_name ||
    profile?.email?.split('@')[0] ||
    'You'
  const email = profile?.email ?? user.email ?? ''

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppNav
        userId={user.id}
        name={displayName}
        email={email}
      />
      {children}
    </div>
  )
}