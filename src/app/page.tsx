// src/app/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { HeroTypingMock } from './_landing/hero-typing-mock'
import { AnimatedHero, AnimatedFeatures } from './_landing/animated-sections'
import { UserMenu } from './_landing/user-menu'


export default async function LandingPage() {
  // If you're signed in, the landing isn't for you — go straight to the app.
  // Doing this server-side means no flash of landing content for authed users.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // If signed in, also pull the profile so we have a name to show in the menu.
  // We're already on the server, so this round-trip is cheap.
  let displayName = ''
  let email = ''
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, email')
      .eq('id', user.id)
      .maybeSingle()
    displayName =
      profile?.display_name ||
      profile?.email?.split('@')[0] ||
      'You'
    email = profile?.email ?? user.email ?? ''
  }

  return (
    <main className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-0 -translate-x-1/2 h-[600px] w-[1200px] rounded-full bg-gradient-to-br from-violet-500/10 via-fuchsia-500/5 to-transparent blur-3xl" />
      </div>

      <nav className="border-b border-border/40 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-6 py-4">
          <Link href="/" className="font-semibold tracking-tight">
            Tandem
          </Link>

          {/* Conditional nav right side: logged-out users see auth CTAs;
              logged-in users see their user menu. */}
          {user ? (
            <UserMenu
              userId={user.id}
              name={displayName}
              email={email}
            />
          ) : (
            <div className="flex items-center gap-4 text-sm">
              <Link
                href="/login"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="rounded-md bg-foreground px-4 py-1.5 text-background font-medium hover:bg-foreground/90 transition-colors"
              >
                Get started
              </Link>
            </div>
          )}
        </div>
      </nav>


    

      {/* Hero — two columns on desktop: text left, typing mock right */}
      <section className="mx-auto max-w-6xl px-6 pt-20 pb-24">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <AnimatedHero />
          <HeroTypingMock />
        </div>
      </section>

      {/* Feature trio — three cards */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <AnimatedFeatures />
      </section>

      {/* Architecture credibility section — for the judges */}
      <section className="border-t border-border/40 bg-card/30">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-sm font-medium uppercase tracking-widest text-muted-foreground mb-6">
            Under the hood
          </h2>
          <div className="grid md:grid-cols-2 gap-8 text-sm leading-relaxed text-muted-foreground">
            <p>
              Collaboration runs on{' '}
              <span className="text-foreground">Yjs CRDTs</span>{' '}
              over a stateful{' '}
              <span className="text-foreground">Hocuspocus</span> WebSocket
              server. Every keystroke produces a binary delta that converges
              deterministically across clients. Documents are persisted as
              snapshots, awareness is ephemeral.
            </p>
            <p>
              Multi-tenant isolation is enforced inside{' '}
              <span className="text-foreground">Postgres</span> via
              row-level security policies, not in application code. The same
              policy that gates a page load gates the WebSocket connection.
            </p>
            <p>
              Code execution runs in disposable{' '}
              <span className="text-foreground">Docker containers</span>{' '}
              with the network disabled, the filesystem read-only, memory
              and PID limits enforced, and a wall-clock timeout. The
              container is the security boundary.
            </p>
            <p>
              Built with{' '}
              <span className="text-foreground">Next.js 14</span>,{' '}
              <span className="text-foreground">Supabase</span>,{' '}
              <span className="text-foreground">Tiptap</span>, and{' '}
              <span className="text-foreground">Monaco</span>. Three
              independent services, deployed separately.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/40">
        <div className="mx-auto max-w-6xl px-6 py-8 flex items-center justify-between text-xs text-muted-foreground">
          <p>Built for Nebula · MDG Space · IIT Roorkee</p>
          <p>© {new Date().getFullYear()}</p>
        </div>
      </footer>
    </main>
  )
}