import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Do NOT put logic between createServerClient and getUser(). getUser()
  // validates the JWT and refreshes it if needed; anything that touches
  // `supabase` before this can race the refresh.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Helper: build a redirect that PRESERVES any cookies getUser() refreshed
  // onto `response`. If we returned a bare NextResponse.redirect, we'd drop
  // the refreshed session cookies and silently log the user out ~once/hour.
  const redirectTo = (path: string) => {
    const redirectResponse = NextResponse.redirect(new URL(path, request.url))
    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value)
    })
    return redirectResponse
  }

  // Protect app routes: bounce logged-out users to login.
  if (
    !user &&
    (request.nextUrl.pathname.startsWith('/rooms') ||
      request.nextUrl.pathname.startsWith('/room/'))
  ) {
    return redirectTo('/login')
  }

  // Redirect authed users away from auth pages, into the app.
  if (
    user &&
    (request.nextUrl.pathname === '/login' ||
      request.nextUrl.pathname === '/signup')
  ) {
    return redirectTo('/rooms')
  }

  // No redirect: return the response that carries any refreshed cookies.
  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg)$).*)',
  ],
}