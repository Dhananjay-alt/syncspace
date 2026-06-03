// src/app/room/[id]/note/[noteId]/note-editor.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'

const COLORS = [
  '#f87171', '#fb923c', '#fbbf24', '#a3e635',
  '#34d399', '#22d3ee', '#60a5fa', '#a78bfa', '#f472b6',
]

function colorForUser(userId: string): string {
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
  // useMemo on [noteId] — recreating on every render would tear down the WebSocket and lose state
  const ydoc = useMemo(() => new Y.Doc(), [noteId])

  const provider = useMemo(() => {
    return new HocuspocusProvider({
      url: process.env.NEXT_PUBLIC_WS_URL!,
      name: `note:${noteId}`,         // ← becomes the URL path; server uses it as note id
      document: ydoc,
      token,                // ← the user's Supabase access token; the server's
                            //   onAuthenticate hook validates this and checks
                            //   room membership. NOTHING is loaded without it.

      onConnect: () => {
        // no-op; awareness is set in the effect below
      },
    })
    // token/user intentionally excluded — provider must stay stable across token refreshes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, ydoc])

  useEffect(() => {
    provider.setAwarenessField('user', {
      id: user.id,
      name: user.name,
      color: colorForUser(user.id),
    } satisfies AwarenessUser)
  }, [provider, user.id, user.name])

  const [status, setStatus] = useState<WebSocketStatus>(
    WebSocketStatus.Connecting
  )
  const [peers, setPeers] = useState<PeerState[]>([])

  useEffect(() => {
    const onStatus = ({ status }: { status: WebSocketStatus }) =>
      setStatus(status)

    const onAwareness = () => {
      // filter out self — presence list shows others only
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

  useEffect(() => {
    return () => {
      provider.destroy()
      ydoc.destroy()
    }
  }, [provider, ydoc])

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          history: false, // Yjs has its own CRDT-aware undo; enabling both breaks undo
        }),
        Collaboration.configure({ document: ydoc, field: 'default' }),
        CollaborationCursor.configure({
          provider,
          user: {
            name: user.name,
            color: colorForUser(user.id),
          },
        }),
      ],
      editorProps: {
        attributes: {
          class:
            'prose prose-invert max-w-none focus:outline-none min-h-[50vh]',
        },
      },
      // Avoid SSR mismatch warnings — Tiptap renders on the client only.
      immediatelyRender: false,
    },
    [ydoc]
  )

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{noteTitle}</h1>
        <div className="flex items-center gap-3">
          <PresencePills peers={peers} />
          <ConnectionDot status={status} />
        </div>
      </div>

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