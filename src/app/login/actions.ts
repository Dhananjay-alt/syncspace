'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// The shape useActionState expects: previous state in, new state out.
// `null` means "no error yet" (initial state or success-then-redirect).
export type AuthState = {
  error: string | null
} | null

export async function login(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  // Pull values off FormData. These are `FormDataEntryValue | null`, so we
  // narrow to string. In a real prod app you'd validate with zod here —
  // I'm keeping it lean for the hackathon but flagging the gap.
  const email = formData.get('email')
  const password = formData.get('password')

  if (typeof email !== 'string' || typeof password !== 'string') {
    return { error: 'Invalid form submission.' }
  }

  // Basic shape check. Supabase will reject malformed emails too, but
  // we want a friendlier message than its raw error string.
  if (!email || !password) {
    return { error: 'Email and password are required.' }
  }

  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    // Supabase returns messages like "Invalid login credentials".
    // We pass them through; in a stricter app you'd map to your own
    // strings to avoid leaking which half of (email, password) was wrong —
    // though Supabase already returns a generic message for that reason.
    return { error: error.message }
  }

  // Why revalidatePath('/', 'layout'):
  // Server Components cached for this user might be showing logged-out UI
  // (e.g., "Sign in" in the navbar). After login, we need Next to throw
  // away that cache and re-render. The 'layout' scope invalidates the
  // root layout and everything beneath, which is the right hammer here.
  revalidatePath('/', 'layout')

  // redirect() throws a special error that Next catches to perform the
  // redirect. It must be called OUTSIDE try/catch — if you wrap it, you
  // swallow the redirect signal. This is a real footgun, file it away.
  redirect('/')
}

export async function signup(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = formData.get('email')
  const password = formData.get('password')

  if (typeof email !== 'string' || typeof password !== 'string') {
    return { error: 'Invalid form submission.' }
  }

  if (!email || !password) {
    return { error: 'Email and password are required.' }
  }

  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters.' }
  }

  const supabase = await createClient()

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // emailRedirectTo controls where the user lands after clicking the
      // confirmation link in their email. This URL must be allow-listed
      // in Supabase dashboard → Authentication → URL Configuration →
      // Redirect URLs, or Supabase will refuse to redirect there.
      //
      // We send them to /auth/callback so we can exchange the code for
      // a session server-side. Same callback we use for OAuth — unified.
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    },
  })

  if (error) {
    return { error: error.message }
  }

  // For email/password signup with email confirmation enabled (default),
  // the user is NOT logged in yet — they need to click the email link.
  // So we don't redirect to '/'; we redirect to a "check your email" page.
  // I'll have you build that page; for now redirect to /login with a flag.
  redirect('/login?message=check-email')
}

export async function signout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}

export async function signInWithGoogle() {
  const supabase = await createClient()

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // After Google authenticates the user, it redirects back to this
      // URL with a `code` param. Our /auth/callback route exchanges that
      // code for a session — the SAME callback we built for email confirm.
      // This is why we unified them earlier: one callback, two flows.
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    },
  })

  if (error) {
    // OAuth errors here are rare (usually misconfig). Send back to login.
    redirect('/login?message=auth-error')
  }

  // signInWithOAuth doesn't log the user in directly — it returns a URL
  // pointing at Google's consent screen. We have to redirect the browser
  // there. data.url is that Google URL.
  if (data.url) {
    redirect(data.url)
  }
}