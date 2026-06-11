import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// This route handles two flows:
// 1. Email confirmation links (signup) — Supabase redirects here with ?code=...
// 2. OAuth provider callbacks (Google) — same shape, also ?code=...
// In both cases we exchange the code for a session, which sets cookies,
// then redirect the user into the app.

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  // 'next' is an optional param telling us where to send the user
  // after successful auth (e.g., they tried to access /rooms/abc
  // while logged out, got bounced to login, we should send them back).
  // For now, default to home. We'll use this when we add protected routes.
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Success: cookies are set, redirect into the app.
      return NextResponse.redirect(`${origin}${next}`)
    }
    // Fall through to error redirect below.
  }

  // Something went wrong: missing code, invalid code, expired code.
  // Send them back to login with an error flag.
  return NextResponse.redirect(`${origin}/login?message=auth-error`)
}