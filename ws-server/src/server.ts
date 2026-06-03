// =============================================================================
// Hocuspocus collaborative editing server
// =============================================================================
// This is a small stateful Node server that holds Y.Doc replicas in memory
// (one per active note) and orchestrates:
//   1. WebSocket connections from clients
//   2. CRDT update fan-out between clients in the same note
//   3. Awareness (presence) fan-out — ephemeral, not persisted
//   4. Authentication on connection (the security gate)
//   5. Document load from Supabase on first open
//   6. Debounced document persistence back to Supabase
//
// Architecture note: we use the Supabase service_role key for DB I/O because
// this process is the system, not a user. Authorization is enforced upfront
// in onAuthenticate by validating the client's user JWT and verifying their
// room_members entry — service_role is never used to bypass user-permission
// checks, only to perform persistence operations on behalf of authorized users.
// =============================================================================

import 'dotenv/config'
import { Server } from '@hocuspocus/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import * as Y from 'yjs'

// --- env validation ---------------------------------------------------------
// Fail loudly at startup if env is misconfigured. Better than a confusing
// runtime error 30 minutes into a demo.
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

// --- Supabase clients -------------------------------------------------------
// We need TWO kinds of Supabase clients in this server:
//
//   1. `adminSupabase` — created once, uses service_role. Used for all
//      persistence operations (reading/writing `notes.ydoc_state`). It
//      bypasses RLS by design.
//
//   2. A per-request user-scoped client created INSIDE onAuthenticate, using
//      the user's JWT. We use this to verify the user is a member of the
//      room — querying through RLS so the database itself enforces the check.
//      We never use service_role for permission checks; that would be the
//      classic "I forgot to write the if-statement" anti-pattern.

const adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    // Server context: no session/cookie persistence. Each request stands alone.
    persistSession: false,
    autoRefreshToken: false,
  },
})

// --- helpers ----------------------------------------------------------------

/**
 * Document names have the shape `<type>:<id>` where type is 'note' or 'code'.
 * This lets one Hocuspocus server serve multiple kinds of documents while
 * routing each to the right table for auth and persistence.
 */
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

/**
 * Build a user-scoped Supabase client given a user JWT. Queries via this
 * client are subject to RLS as that user.
 */
function userSupabaseFromToken(token: string): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// --- Hocuspocus server ------------------------------------------------------

const server = new Server({
  port: PORT,
  // Hocuspocus accepts the host as 0.0.0.0 by default; fine for both local
  // dev and Railway's container networking.


async onAuthenticate({ token, documentName }) {
    console.log('[onAuthenticate] documentName:', documentName, 'tokenPresent:', !!token)
    if (!token) throw new Error('Missing auth token')

    const ref = parseDocumentName(documentName)
    if (!ref) throw new Error('Invalid document name')

    // Validate the JWT — confirms the user is who they say they are.
    const { data: userData, error: userError } =
      await adminSupabase.auth.getUser(token)
    if (userError || !userData?.user) throw new Error('Invalid auth token')
    const user = userData.user

    // Permission check via RLS: select the document through the user's
    // scope. If they're not a member of the owning room, RLS hides the
    // row and we treat it as "not authorized" (don't distinguish from
    // "doesn't exist" — same reason 404 vs 403 was collapsed elsewhere).
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

  // Tunable: how long the server waits after the last change before calling
  // onStoreDocument. Default is 2000ms. Lower = more writes, fresher state
  // if the server dies. Higher = fewer writes, more potential loss.
  // 2 seconds is the sweet spot for collaborative editing.
  debounce: 2000,

  // Hard limit: regardless of debounce, store at least this often during
  // sustained editing. Otherwise a user who never pauses could go a long
  // time without their work hitting durable storage.
  maxDebounce: 10000,
})

// --- helpers continued ------------------------------------------------------

/**
 * Supabase's PostgREST returns `bytea` columns as one of two shapes depending
 * on client version and column metadata:
 *   - a hex string like "\x4a8e..." (the legacy default)
 *   - or, sometimes, a base64 string
 *   - or, in newer JS client versions, an actual Uint8Array
 * We normalize to Uint8Array so the rest of the code doesn't care.
 */
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

// --- start ------------------------------------------------------------------

server.listen()
console.log(`Hocuspocus listening on ws://localhost:${PORT}`)