// src/app/(app)/room/[id]/copy-invite-button.tsx
'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

// Click-to-copy is one of those things users notice when it works smoothly.
// We give visual feedback (the icon flips to a checkmark, the label changes)
// for ~1.5s after copy, then reverts. Pure clientside — no Server Action
// needed for a clipboard write.
export function CopyInviteButton({ inviteCode }: { inviteCode: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(inviteCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard write can fail in non-HTTPS dev contexts or if the user
      // denied permission. Silently no-op — better than throwing.
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-card/40 px-3 py-1.5 text-xs font-mono hover:bg-card/80 hover:border-border transition-colors"
      aria-label={copied ? 'Copied' : 'Copy invite code'}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
      )}
      <span>{copied ? 'Copied!' : inviteCode}</span>
    </button>
  )
}