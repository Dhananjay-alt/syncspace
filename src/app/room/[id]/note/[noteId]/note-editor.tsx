// src/app/room/[id]/note/[noteId]/note-editor.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'

// ─────────────────────────────────────────────────────────────────────────────
// PRESENCE: a tiny user color palette. Each connected user gets one assigned
// from the hash of their user id, so the same person gets the same color
// across reloads. CollaborationCursor uses this for their remote cursor tint.
// ─────────────────────────────────────────────────────────────────────────────
const COLORS = [
  '#f87171', '#fb923c', '#fbbf24', '#a3e635',
  '#34d399', '#22d3ee', '#60a5fa', '#a78bfa', '#f472b6',
]

function colorForUser(userId: string): string {
  // Deterministic hash → palette index. Same user, same color, every time.
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0
  }
  return COLORS[Math.abs(hash) % COLORS.length]
}

type AwarenessUser = {
  id: string
  name: string
  color: string
}

type PeerState = {
  clientId: number
  user: AwarenessUser
}

export function NoteEditor({
  noteId,
  noteTitle,
  token,
  user,
}: {
  noteId: string
  noteTitle: string
  token: string
  user: { id: string; name: string }
}) {
  // ───────────────────────────────────────────────────────────────────────────
  // Y.Doc + provider are created ONCE per mount via useMemo. They MUST NOT be
  // recreated on rerender — every recreation would tear down the WebSocket,
  // throw away local state, and reconnect. Memoizing on [noteId] means they
  // only get rebuilt if you navigate to a different note, which is correct.
  //
  // Why not useState + lazy initializer? useMemo gives us the same lifetime
  // semantics and reads more naturally for derived objects. Both work.
  // ───────────────────────────────────────────────────────────────────────────
  const ydoc = useMemo(() => new Y.Doc(), [noteId])

  const provider = useMemo(() => {
    return new HocuspocusProvider({
      url: process.env.NEXT_PUBLIC_WS_URL!,
      name: noteId,         // ← becomes the URL path; server uses it as note id
      document: ydoc,
      token,                // ← the user's Supabase access token; the server's
                            //   onAuthenticate hook validates this and checks
                            //   room membership. NOTHING is loaded without it.

      // Push our identity into awareness as soon as we connect. Other peers
      // will read this off awareness to render our cursor/name. Note that
      // awareness is fully separate from the document — never persisted.
      onConnect: () => {
        // no-op; awareness is set via the awareness setter below
      },
    })
    // We deliberately do NOT include `token` or `user` in deps. Memoizing on
    // noteId alone keeps the provider stable across token refreshes (see
    // pass 3 for why that's deliberate and what we do about refreshes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, ydoc])

  // ───────────────────────────────────────────────────────────────────────────
  // Awareness: tell other peers who we are. This must happen after the
  // provider exists. We set it on every mount; on the wire it's a small
  // ephemeral broadcast, harmless to repeat.
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    provider.setAwarenessField('user', {
      id: user.id,
      name: user.name,
      color: colorForUser(user.id),
    } satisfies AwarenessUser)
  }, [provider, user.id, user.name])

  // ───────────────────────────────────────────────────────────────────────────
  // Local state mirrors of provider events, for rendering connection status
  // and the presence pill list. We subscribe to provider events and copy
  // changes into React state — React doesn't know about provider's internal
  // changes otherwise.
  // ───────────────────────────────────────────────────────────────────────────
  const [status, setStatus] = useState<WebSocketStatus>(
    WebSocketStatus.Connecting
  )
  const [peers, setPeers] = useState<PeerState[]>([])

  useEffect(() => {
    const onStatus = ({ status }: { status: WebSocketStatus }) =>
      setStatus(status)

    const onAwareness = () => {
      // awareness.getStates() returns Map<clientId, state>. Each remote peer
      // (and we ourselves) appears here. We filter out our own entry so the
      // presence row shows OTHER people, not "you".
      const states = provider.awareness?.getStates() ?? new Map()
      const myClientId = provider.awareness?.clientID
      const others: PeerState[] = []
      states.forEach((state, clientId) => {
        if (clientId === myClientId) return
        if (state?.user) {
          others.push({ clientId, user: state.user as AwarenessUser })
        }
      })
      setPeers(others)
    }

    provider.on('status', onStatus)
    provider.awareness?.on('change', onAwareness)
    onAwareness() // initial populate

    return () => {
      provider.off('status', onStatus)
      provider.awareness?.off('change', onAwareness)
    }
  }, [provider])

  // ───────────────────────────────────────────────────────────────────────────
  // Cleanup: when this component unmounts (you navigate away), tear down
  // the provider and destroy the Y.Doc. Without this you'd leak WebSocket
  // connections and Y.Doc memory across navigations.
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      provider.destroy()
      ydoc.destroy()
    }
  }, [provider, ydoc])

  // ───────────────────────────────────────────────────────────────────────────
  // The Tiptap editor itself. Note two critical things:
  //   1. StarterKit's `history` is DISABLED — Yjs provides its own undo
  //      stack that's CRDT-aware. Having both produces broken undo behavior
  //      (your local undo would undo a remote change, etc.). Always disable.
  //   2. Collaboration binds the editor to the Y.Doc. CollaborationCursor
  //      hooks into awareness to render remote cursors with their colors.
  // ───────────────────────────────────────────────────────────────────────────
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          history: false, // ← required when using Collaboration
        }),
        Collaboration.configure({ document: ydoc }),
        CollaborationCursor.configure({
          provider,
          user: {
            name: user.name,
            color: colorForUser(user.id),
          },
        }),
      ],
      // Tiptap injects classes onto the editable element; this keeps the
      // prose styling consistent with the rest of the app. Tailwind's
      // typography plugin would be ideal here, but plain styling works.
      editorProps: {
        attributes: {
          class:
            'prose prose-invert max-w-none focus:outline-none min-h-[50vh]',
        },
      },
      // Avoid SSR mismatch warnings — Tiptap renders on the client only.
      immediatelyRender: false,
    },
    // Rebuild the editor when the underlying doc changes (i.e. note id change).
    [ydoc]
  )

  // ───────────────────────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header: title + presence + status */}
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{noteTitle}</h1>
        <div className="flex items-center gap-3">
          <PresencePills peers={peers} />
          <ConnectionDot status={status} />
        </div>
      </div>

      {/* The editor */}
      <div className="rounded-lg border border-border bg-card p-4">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

function PresencePills({ peers }: { peers: PeerState[] }) {
  if (peers.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">Just you here</span>
    )
  }
  return (
    <div className="flex -space-x-2">
      {peers.map((peer) => (
        <div
          key={peer.clientId}
          title={peer.user.name}
          className="h-7 w-7 rounded-full border-2 border-background flex items-center justify-center text-xs font-medium text-background"
          style={{ backgroundColor: peer.user.color }}
        >
          {peer.user.name.charAt(0).toUpperCase()}
        </div>
      ))}
    </div>
  )
}

function ConnectionDot({ status }: { status: WebSocketStatus }) {
  const color =
    status === WebSocketStatus.Connected
      ? 'bg-green-500'
      : status === WebSocketStatus.Connecting
        ? 'bg-yellow-500'
        : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="text-xs text-muted-foreground capitalize">
        {status}
      </span>
    </div>
  )
}