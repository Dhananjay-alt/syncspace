// src/app/api/run/route.ts
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Limits we mirror from the exec-server. Reject early on this side too —
// no point sending an oversized payload across the network.
const MAX_CODE_BYTES = 100_000

export async function POST(request: NextRequest) {
  // 1. Auth: the user must be signed in.
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Parse and validate input.
  let body: { code?: unknown; roomId?: unknown; language?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const code = typeof body.code === 'string' ? body.code : ''
  const roomId = typeof body.roomId === 'string' ? body.roomId : ''
  const language = typeof body.language === 'string' ? body.language : 'python'

  if (!code) return NextResponse.json({ error: 'Code is required' }, { status: 400 })
  if (code.length > MAX_CODE_BYTES) {
    return NextResponse.json({ error: 'Code too large' }, { status: 400 })
  }
  if (!roomId) return NextResponse.json({ error: 'roomId required' }, { status: 400 })
  if (language !== 'python') {
    return NextResponse.json({ error: 'Only python supported' }, { status: 400 })
  }

  // 3. RLS check: confirm the user is a member of this room.
  // We query rooms.id with .eq(roomId) — RLS lets it through only if the
  // user is a member. If RLS hides the row, .maybeSingle() returns null
  // and we treat it as "not authorized." Same pattern as the Hocuspocus
  // onAuthenticate hook — RLS is the gate, our code just observes it.
  const { data: room } = await supabase
    .from('rooms')
    .select('id')
    .eq('id', roomId)
    .maybeSingle()

  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  // 4. Forward to the executor. The shared secret authenticates US to it.
  // Note: we deliberately don't pass any user identity downstream — the
  // executor doesn't know or care who's running the code; it just sandboxes
  // and runs. Permission is fully decided here.
  const execUrl = process.env.EXEC_SERVER_URL
  const execSecret = process.env.EXEC_SHARED_SECRET
  if (!execUrl || !execSecret) {
    console.error('EXEC_SERVER_URL or EXEC_SHARED_SECRET missing')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  let execResponse: Response
  try {
    execResponse = await fetch(`${execUrl}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-exec-secret': execSecret,
      },
      body: JSON.stringify({ code, language }),
      // Belt + braces: explicit fetch-level timeout in case the exec-server
      // takes longer than expected. The executor has its own wall-clock
      // limit (~10s); we give it some headroom (15s) before we give up.
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    console.error('exec-server fetch failed:', err)
    return NextResponse.json(
      { error: 'Execution service unavailable' },
      { status: 502 } // Bad Gateway — upstream service issue
    )
  }

  if (!execResponse.ok) {
    console.error('exec-server returned', execResponse.status)
    return NextResponse.json(
      { error: 'Execution failed' },
      { status: 502 }
    )
  }

  const result = await execResponse.json()
  // 5. Return the executor's response directly to the browser.
  return NextResponse.json(result)
}