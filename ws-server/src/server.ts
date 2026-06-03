// service_role key used for persistence only — auth is enforced upfront in
// onAuthenticate via a user-scoped client. service_role never bypasses permission checks.

import 'dotenv/config'
import { Server } from '@hocuspocus/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import * as Y from 'yjs'

// fail loud at startup rather than a confusing runtime error later
const PORT = Number(process.env.PORT ?? 1234)
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Missing required env: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
  )
  process.exit(1)
}

// adminSupabase: service_role for persistence (bypasses RLS by design)
// user-scoped client built per-request in onAuthenticate to check membership via RLS
const adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    // server context — no session/cookie persistence
    persistSession: false,
    autoRefreshToken: false,
  },
})

type DocRef =
  | { type: 'note'; id: string }
  | { type: 'code'; id: string }

function parseDocumentName(documentName: string): DocRef | null {
  const [type, id] = documentName.split(':', 2)
  if (!id) return null
  if (type === 'note') return { type: 'note', id }
  if (type === 'code') return { type: 'code', id }
  return null
}

function userSupabaseFromToken(token: string): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const server = new Server({
  port: PORT,

async onAuthenticate({ token, documentName }) {
    console.log('[onAuthenticate] documentName:', documentName, 'tokenPresent:', !!token)
    if (!token) throw new Error('Missing auth token')

    const ref = parseDocumentName(documentName)
    if (!ref) throw new Error('Invalid document name')

    const { data: userData, error: userError } =
      await adminSupabase.auth.getUser(token)
    if (userError || !userData?.user) throw new Error('Invalid auth token')
    const user = userData.user

    // RLS does the membership check — if the user isn't in the room the row is hidden.
    // We collapse 404 vs 403 deliberately (consistent with the rest of the app).
    const userSupabase = userSupabaseFromToken(token)

    if (ref.type === 'note') {
      const { data: note, error } = await userSupabase
        .from('notes')
        .select('id, room_id')
        .eq('id', ref.id)
        .maybeSingle()
      if (error) {
        console.error('onAuthenticate (note) lookup error', error)
        throw new Error('Authentication failed')
      }
      if (!note) throw new Error('Not authorized')

      return {
        userId: user.id,
        userEmail: user.email,
        roomId: note.room_id,
        docType: 'note' as const,
        docId: ref.id,
      }
    } else {
      // code session
      const { data: session, error } = await userSupabase
        .from('code_sessions')
        .select('id, room_id')
        .eq('id', ref.id)
        .maybeSingle()
      if (error) {
        console.error('onAuthenticate (code) lookup error', error)
        throw new Error('Authentication failed')
      }
      if (!session) throw new Error('Not authorized')

      return {
        userId: user.id,
        userEmail: user.email,
        roomId: session.room_id,
        docType: 'code' as const,
        docId: ref.id,
      }
    }
  },


async onLoadDocument({ documentName, context }) {
    const ref = parseDocumentName(documentName)
    if (!ref) throw new Error('Invalid document name')

    const table = ref.type === 'note' ? 'notes' : 'code_sessions'
    console.log(`onLoadDocument: ${ref.type}:${ref.id} user=${context?.userId ?? '(none)'}`)

    const { data, error } = await adminSupabase
      .from(table)
      .select('ydoc_state')
      .eq('id', ref.id)
      .maybeSingle()

    if (error) {
      console.error('onLoadDocument failed', error)
      throw new Error('Could not load document')
    }

    const ydoc = new Y.Doc()
    if (data?.ydoc_state) {
      const bytes = toUint8Array(data.ydoc_state)
      Y.applyUpdate(ydoc, bytes)
    }
    return ydoc
  },

  async onStoreDocument({ documentName, document, context }) {
    const ref = parseDocumentName(documentName)
    if (!ref) throw new Error('Invalid document name')

    const table = ref.type === 'note' ? 'notes' : 'code_sessions'
    console.log(`onStoreDocument: ${ref.type}:${ref.id} user=${context?.userId ?? '(none)'}`)
    const state = Y.encodeStateAsUpdate(document)
    // Postgres bytea text format: '\x' followed by hex pairs. Supabase's JS
    // client can't send raw binary via the JSON API — it would Buffer.toJSON()
    // the bytes into a {type:'Buffer',data:[...]} object and Postgres would
    // store the literal JSON text as bytes (which then fails to decode as Yjs).
    // Encoding to hex string up-front gives Postgres exactly what bytea expects.
    const hexEncoded = '\\x' + Buffer.from(state).toString('hex')

    const { error } = await adminSupabase
      .from(table)
      .update({
        ydoc_state: hexEncoded,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ref.id)

    if (error) {
      console.error('onStoreDocument failed', error)
      throw error
    }
  },

  debounce: 2000,     // ms after last change before persisting; 2s is the sweet spot for collab
  maxDebounce: 10000, // force persist after 10s of sustained editing with no pause
})

// Supabase returns bytea as hex (\x...), base64, or Uint8Array depending on client version — normalize.
function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (Buffer.isBuffer(value)) return new Uint8Array(value)
  if (typeof value === 'string') {
    if (value.startsWith('\\x')) {
      // Hex-encoded bytea: '\x' + hex pairs
      const hex = value.slice(2)
      const out = new Uint8Array(hex.length / 2)
      for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16)
      }
      return out
    }
    // Otherwise assume base64
    return new Uint8Array(Buffer.from(value, 'base64'))
  }
  throw new Error(`Cannot decode ydoc_state of type ${typeof value}`)
}

server.listen()
console.log(`Hocuspocus listening on ws://localhost:${PORT}`)