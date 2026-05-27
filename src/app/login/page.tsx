import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LoginForm } from './login-form'

// This is a Server Component (no 'use client' directive). It runs on
// the server on every request to /login. We use it to:
// 1. Check if the user is already logged in → bounce them away.
// 2. Read the search params for the "check your email" flag.
// The actual form is a Client Component because useActionState is a
// client-only hook (it needs to manage state across re-renders).

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>
}) {
  // Note: in Next 15+, searchParams is a Promise. You await it.
  // In Next 14 it's the object directly. Adjust if you're on 14.
  const params = await searchParams

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Already logged in? Don't show them the login page.
  // This is also enforced by middleware, but defense-in-depth is cheap.
  if (user) {
    redirect('/')
  }

  const showCheckEmailMessage = params.message === 'check-email'

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to your study workspace
          </p>
        </div>

        {showCheckEmailMessage && (
          <div className="rounded-md border border-border bg-card p-4 text-sm">
            Check your email for a confirmation link to complete signup.
          </div>
        )}

        <LoginForm />
      </div>
    </main>
  )
}