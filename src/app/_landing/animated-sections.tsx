// src/app/_landing/animated-sections.tsx
'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'

// ───────────────────────────────────────────────────────────────────────────
// Hero text + CTAs, with a tasteful entry animation.
// Each element fades in and slides up slightly, staggered 80ms apart.
// One-shot, fires on mount.
// ───────────────────────────────────────────────────────────────────────────
export function AnimatedHero() {
  // Reusable variants object: framer-motion lets us define the start/end
  // states once and reference them by name. `delay` gives us the stagger.
  const fadeUp = {
    hidden: { opacity: 0, y: 12 },
    visible: (delay: number) => ({
      opacity: 1,
      y: 0,
      transition: {
        delay,
        duration: 0.5,
        ease: [0.22, 1, 0.36, 1] as const, // "ease-out-quart" — feels confident, not snappy
      },
    }),
  }

  return (
    <div className="space-y-6">
      <motion.span
        className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/50 px-3 py-1 text-xs text-muted-foreground"
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={0}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
        Real-time collaborative workspace
      </motion.span>

      <motion.h1
        className="text-5xl md:text-6xl font-semibold tracking-tight leading-[1.05]"
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={0.08}
      >
        Study sessions,
        <br />
        <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-rose-300 bg-clip-text text-transparent">
          in sync.
        </span>
      </motion.h1>

      <motion.p
        className="text-base md:text-lg text-muted-foreground max-w-md leading-relaxed"
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={0.16}
      >
        Shared notes, a sandboxed Python editor, and live presence — built for
        focused group work. Everyone in the room sees the same thing, instantly.
      </motion.p>

      <motion.div
        className="flex flex-wrap items-center gap-3"
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        custom={0.24}
      >
        <Link
          href="/signup"
          className="rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:bg-foreground/90 transition-colors"
        >
          Create a room
        </Link>
        <Link
          href="/login"
          className="rounded-md border border-border px-5 py-2.5 text-sm font-medium hover:bg-card/60 transition-colors"
        >
          Sign in
        </Link>
      </motion.div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Feature cards. Stagger in as the user scrolls them into view.
// `whileInView` is framer-motion's intersection-observer integration.
// ───────────────────────────────────────────────────────────────────────────
const FEATURES = [
  {
    title: 'Collaborative notes',
    body: 'Rich-text editing powered by Yjs CRDTs. Edits merge without conflicts. Cursors and selections are visible in real time.',
  },
  {
    title: 'Shared code execution',
    body: 'A Monaco-based Python editor, one per room. Anyone can run; everyone sees the output. Code runs in a hardened Docker sandbox.',
  },
  {
    title: 'Multi-tenant by design',
    body: 'Rooms isolated at the database layer via Postgres row-level security. The DB enforces tenancy — not application logic.',
  },
]

export function AnimatedFeatures() {
  return (
    <div className="grid md:grid-cols-3 gap-4">
      {FEATURES.map((feature, i) => (
        <motion.div
          key={feature.title}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{
            duration: 0.5,
            delay: i * 0.08,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="group rounded-xl border border-border/60 bg-card/50 p-6 hover:border-border hover:bg-card/80 transition-colors"
        >
          <h3 className="font-medium mb-2">{feature.title}</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {feature.body}
          </p>
        </motion.div>
      ))}
    </div>
  )
}