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
 * The Hocuspocus document name doubles as the note ID. We use it as the URL
 * path on the client (`ws://host/<noteId>`) and Hocuspocus passes it to every
 * hook as `documentName`. Wrapping the lookup in a function makes the
 * "note id == document name" decision visible and easy to change later.
 */
function noteIdFromDocumentName(documentName: string): string {
  return documentName
}

/**
 * Build a user-scoped Supabase client given a user JWT. This client will
 * make queries AS that user — meaning RLS policies fire with auth.uid()
 * set to that user's id. We use this for permission checks where we want
 * the database to be the gate.
 */
function userSupabaseFromToken(token: string): SupabaseClient {
  return createClient(SUPABASE_URL!, process.env.SUPABASE_ANON_KEY ?? '', {
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// --- Hocuspocus server ------------------------------------------------------

const server = new Server({
  port: PORT,
  // Hocuspocus accepts the host as 0.0.0.0 by default; fine for both local
  // dev and Railway's container networking.

  // -------------------------------------------------------------------------
  // HOOK 1: onAuthenticate — THE SECURITY GATE
  // -------------------------------------------------------------------------
  // Runs on every new WebSocket connection, before the document is loaded
  // or any updates are exchanged. We have three jobs:
  //   1. Validate the JWT the client sent (proves they are who they claim).
  //   2. Confirm the user is a member of the room that owns this note.
  //   3. Reject the connection if either check fails.
  //
  // If this hook throws, Hocuspocus closes the WebSocket. No document is
  // loaded, no fan-out happens. This is the ONLY thing standing between
  // a public WebSocket port and your entire users' note contents.
  //
  // The `token` comes from the client via `provider.token` (we'll wire that
  // on the Tiptap side next turn). The `documentName` is the URL path.
  //
  // We return a `context` object that Hocuspocus attaches to every subsequent
  // hook call for this connection — useful for storing the authenticated
  // user id and skipping re-lookups.
  async onAuthenticate({ token, documentName }) {
    if (!token) {
      // No token at all → reject. The thrown error becomes a clean close
      // on the client side ("unauthorized").
      throw new Error('Missing auth token')
    }

    // Step 1: validate the JWT by asking Supabase who the user is.
    // We use the admin client here as a convenience — `getUser(token)` does
    // not require the client to be user-scoped; it just verifies the token.
    const { data: userData, error: userError } =
      await adminSupabase.auth.getUser(token)

    if (userError || !userData?.user) {
      throw new Error('Invalid auth token')
    }
    const user = userData.user
    const noteId = noteIdFromDocumentName(documentName)

    // Step 2: confirm the user is a member of the room that owns this note.
    // We do this via the USER-SCOPED client so RLS does the work — exactly
    // mirroring how the app reads notes. If RLS lets the user select this
    // note, they're a member; if not, the row is invisible to them.
    //
    // (Yes, we could query room_members with the admin client and check by
    // hand. Going through RLS instead means "the same policy that gates the
    // Next.js read also gates the WebSocket connection" — one source of
    // truth. Defense in depth and consistency in one stroke.)
    const userSupabase = userSupabaseFromToken(token)
    const { data: note, error: noteError } = await userSupabase
      .from('notes')
      .select('id, room_id')
      .eq('id', noteId)
      .maybeSingle()

    if (noteError) {
      console.error('onAuthenticate: note lookup error', noteError)
      throw new Error('Authentication failed')
    }
    if (!note) {
      // Either the note doesn't exist, or it does but the user isn't a
      // member of its room (RLS hid it). We do NOT distinguish — same
      // reason 404 vs 403 is collapsed in the app: don't leak existence.
      throw new Error('Not authorized')
    }

    // Returned object becomes `connection.context` for the rest of this
    // connection's lifetime. Stash the user id for awareness/logging later.
    return {
      userId: user.id,
      userEmail: user.email,
      roomId: note.room_id,
      noteId,
    }
  },

  // -------------------------------------------------------------------------
  // HOOK 2: onLoadDocument — RECONSTRUCT FOR A NEW JOINER
  // -------------------------------------------------------------------------
  // Fires the FIRST time a document is opened (no in-memory Y.Doc yet) OR
  // after the doc was evicted from memory. Our job: return a Y.Doc populated
  // from whatever we have in Supabase.
  //
  // The snapshot we stored is `Y.encodeStateAsUpdate(doc)` — a binary blob
  // representing the entire document state. To reconstruct, we create a new
  // Y.Doc and apply the update. Note: this is the SAME pattern that would
  // be used for an append log (apply each row); we just happen to have one
  // row per note.
  async onLoadDocument({ documentName, context }) {
    const noteId = noteIdFromDocumentName(documentName)
    // context may be undefined: this hook can fire from a connection-less
    // path (e.g., document reload after eviction). We only log the user
    // if we have one — never assume context.userId exists.
    console.log(`onLoadDocument: ${noteId} user=${context?.userId ?? '(none)'}`)

    const { data, error } = await adminSupabase
      .from('notes')
      .select('ydoc_state')
      .eq('id', noteId)
      .maybeSingle()

    if (error) {
      // Loud log; throwing here would refuse the document load and the
      // client would see a close. For a hackathon this is acceptable; in
      // production you'd want a retry or fallback strategy.
      console.error('onLoadDocument: failed to load', error)
      throw new Error('Could not load document')
    }

    // Create a fresh Y.Doc to populate.
    const ydoc = new Y.Doc()

    if (data?.ydoc_state) {
      // Supabase returns bytea as a hex-encoded string by default with the
      // PostgREST API ('\x...'). The Supabase JS client decodes this for us
      // into a Uint8Array... actually, it depends. Let's normalize:
      const bytes = toUint8Array(data.ydoc_state)
      Y.applyUpdate(ydoc, bytes)
    }
    // else: brand new note, empty Y.Doc is correct.

    return ydoc
  },

  // -------------------------------------------------------------------------
  // HOOK 3: onStoreDocument — DEBOUNCED PERSISTENCE
  // -------------------------------------------------------------------------
  // Fires after a debounce period of inactivity (default ~2s; configurable
  // via the `debounce` option on the server). Hocuspocus hands us the live
  // Y.Doc; we encode it and overwrite `ydoc_state`. We also bump updated_at.
  //
  // Important: this is the AUTHORITATIVE Y.Doc on the server, holding all
  // merged updates from every client. We're not racing with concurrent
  // writers from elsewhere — the in-memory doc is the single source of truth
  // for this note while at least one client is connected.
  async onStoreDocument({ documentName, document, context }) {
    const noteId = noteIdFromDocumentName(documentName)
    // context is often undefined for store: the hook fires on a debounce
    // and represents the merged state of many users' edits (possibly
    // after some of them disconnected). Don't assume it exists.
    console.log(`onStoreDocument: ${noteId} user=${context?.userId ?? '(none)'}`)

    // Encode the entire current state. This is what we'll replay on load.
    const state = Y.encodeStateAsUpdate(document)

    // Convert Uint8Array → Buffer for the Supabase client. The PostgREST
    // bytea binding accepts a node Buffer cleanly.
    const buffer = Buffer.from(state)

    const { error } = await adminSupabase
      .from('notes')
      .update({
        ydoc_state: buffer,
        updated_at: new Date().toISOString(),
      })
      .eq('id', noteId)

    if (error) {
      // Log loudly. Throwing here aborts the store; Hocuspocus will retry
      // on the next debounce window. Don't swallow.
      console.error('onStoreDocument: failed to save', error)
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