// src/app/_landing/hero-typing-mock.tsx
'use client'

import { useEffect, useState } from 'react'

// ───────────────────────────────────────────────────────────────────────────
// Simulates two users collaborating on a single document.
// The "script" is a sequence of edits, each tagged with which user made it.
// We replay the script with delays, and once it finishes, restart from empty.
// Pure useState + setTimeout — no library, no canvas, no DOM tricks.
// ───────────────────────────────────────────────────────────────────────────

type Edit = {
  user: 'A' | 'B'
  text: string
  delay: number // ms before this edit fires
}

const SCRIPT: Edit[] = [
  { user: 'A', text: 'def fibonacci(n):\n', delay: 400 },
  { user: 'A', text: '    if n < 2:\n', delay: 300 },
  { user: 'A', text: '        return n\n', delay: 300 },
  { user: 'B', text: '    a, b = 0, 1\n', delay: 600 },
  { user: 'B', text: '    for _ in range(n):\n', delay: 350 },
  { user: 'B', text: '        a, b = b, a + b\n', delay: 350 },
  { user: 'A', text: '    return a\n', delay: 500 },
  { user: 'A', text: '\nprint(fibonacci(10))', delay: 700 },
]

const RESTART_DELAY = 3500 // pause after script completes before restarting

export function HeroTypingMock() {
  const [content, setContent] = useState('')
  const [activeUser, setActiveUser] = useState<'A' | 'B' | null>(null)
  const [step, setStep] = useState(0)

  useEffect(() => {
    let cancelled = false

    function play(index: number, currentContent: string) {
      if (cancelled) return

      if (index >= SCRIPT.length) {
        // Reached the end. Pause, then reset.
        const t = setTimeout(() => {
          if (cancelled) return
          setContent('')
          setActiveUser(null)
          setStep(0)
          play(0, '')
        }, RESTART_DELAY)
        return () => clearTimeout(t)
      }

      const edit = SCRIPT[index]
      const t = setTimeout(() => {
        if (cancelled) return
        const next = currentContent + edit.text
        setContent(next)
        setActiveUser(edit.user)
        setStep(index + 1)
        play(index + 1, next)
      }, edit.delay)
      return () => clearTimeout(t)
    }

    play(0, '')

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="relative">
      {/* The "window chrome" — title bar with traffic lights + room name.
          Helps signal "this is a UI mock" rather than "this is decorative". */}
      <div className="rounded-xl border border-border/60 bg-card/80 shadow-2xl shadow-violet-500/10 backdrop-blur">
        {/* Title bar */}
        <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-green-500/70" />
          </div>
          <div className="flex items-center gap-3">
            <PresencePill name="A" color="#22d3ee" active={activeUser === 'A'} />
            <PresencePill name="B" color="#f472b6" active={activeUser === 'B'} />
          </div>
        </div>

        {/* The "editor" — monospaced font, dim background, with the current
            typed text. The last character is followed by a colored caret
            indicating who's currently typing. */}
        <div className="p-4 font-mono text-xs leading-relaxed min-h-[280px]">
          <pre className="text-foreground/90 whitespace-pre-wrap">
            {content}
            {activeUser && (
              <span
                className="inline-block w-[2px] h-[1.2em] align-[-0.2em] animate-pulse"
                style={{
                  backgroundColor: activeUser === 'A' ? '#22d3ee' : '#f472b6',
                }}
              />
            )}
          </pre>
        </div>

        {/* Footer with a fake "run" affordance. Static — doesn't need to
            animate to feel real. */}
        <div className="border-t border-border/40 px-4 py-2.5 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Python sandbox</span>
          <span className="rounded-md bg-foreground/10 px-2.5 py-1 text-foreground/70">
            ▶ Run
          </span>
        </div>
      </div>
    </div>
  )
}

function PresencePill({
  name,
  color,
  active,
}: {
  name: string
  color: string
  active: boolean
}) {
  // When active, the pill gets a soft outer glow matching the user's color.
  // Subtle but communicates "this user is typing right now."
  return (
    <div
      className="flex items-center gap-1.5 transition-all duration-200"
      style={{
        // box-shadow approximates a glow — color at low opacity, blurred.
        filter: active ? `drop-shadow(0 0 8px ${color})` : 'none',
      }}
    >
      <div
        className="h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-medium text-background"
        style={{ backgroundColor: color }}
      >
        {name}
      </div>
    </div>
  )
}