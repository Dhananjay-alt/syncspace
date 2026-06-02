// =============================================================================
// exec-server — sandboxed Python execution service
// =============================================================================
// Receives { code } over HTTP, spawns a hardened Docker container, captures
// stdout/stderr/exitCode, returns them. This is the most security-critical
// service in the project — every flag and limit below corresponds to a
// specific attack we are blocking.
//
// What we defend against (the in-scope threat model):
//   1. Filesystem read/write outside the sandbox      → --read-only + tmpfs
//   2. Network access (exfiltration, downloads)       → --network=none
//   3. Resource exhaustion (RAM, CPU, fork bombs)     → memory/cpu/pids limits
//   4. Privilege escalation inside the container      → cap-drop + no-new-priv
//   5. Persistence between runs                       → container-per-run + --rm
//   6. Output flooding the host process               → bounded stdout/stderr
//   7. Infinite loops / slow code                     → wall-clock timeout
//
// What we explicitly do NOT defend against:
//   - Kernel exploits (zero-days in Linux containerization)
//   - Side-channel attacks (Spectre-class)
//   - Pure CPU within the budget (computing 2**1000000 is allowed if it fits)
//   - A determined attacker spamming many submissions (rate limiting is in
//     the Next.js layer, not here; this service trusts its single caller)
// =============================================================================

import 'dotenv/config'
import express, { type Request, type Response, type NextFunction } from 'express'
import Docker from 'dockerode'
import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { timingSafeEqual } from 'node:crypto'

// --- env --------------------------------------------------------------------
const PORT = Number(process.env.PORT ?? 4000)
const EXEC_SHARED_SECRET = process.env.EXEC_SHARED_SECRET
const DOCKER_IMAGE = process.env.DOCKER_IMAGE ?? 'nebula-python-sandbox:latest'

if (!EXEC_SHARED_SECRET || EXEC_SHARED_SECRET.length < 16) {
  console.error('EXEC_SHARED_SECRET is missing or too short (need >= 16 chars)')
  process.exit(1)
}

// --- limits (single source of truth, easy to tune later) -------------------
const LIMITS = {
  wallTimeMs: 10_000,      // 10s total wall clock — caps infinite loops
  memoryBytes: 256 * 1024 * 1024,   // 256MB RAM (and same for swap, so no swap)
  cpus: 0.5,               // half a core; cooperative throttling
  pidsLimit: 64,           // max processes; kills fork bombs
  maxCodeBytes: 100_000,   // 100KB code size cap on input
  maxOutputBytes: 64_000,  // 64KB per stream (stdout, stderr) — caps log flood
  tmpfsBytes: 64 * 1024 * 1024,     // 64MB writable /tmp
} as const

// --- Docker client ---------------------------------------------------------
// dockerode connects via the Unix socket by default at /var/run/docker.sock,
// which is what Docker Desktop's WSL integration exposes. No config needed.
const docker = new Docker()

// --- HTTP server -----------------------------------------------------------
const app = express()
app.use(express.json({ limit: '200kb' })) // small ceiling on the whole body

// Auth middleware: every /execute request must carry the shared secret.
// Use a constant-time comparison to avoid timing-attack leaks of the secret.
function requireSecret(req: Request, res: Response, next: NextFunction) {
  const header = req.header('x-exec-secret') ?? ''
  // crypto.timingSafeEqual requires equal-length buffers, so length-check first.
  if (
    header.length !== EXEC_SHARED_SECRET!.length ||
    !timingSafeStringEqual(header, EXEC_SHARED_SECRET!)
  ) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return timingSafeEqual(ab, bb)
}

app.get('/health', (_req, res) => res.json({ ok: true }))

app.post('/execute', requireSecret, async (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code : ''
  const language = req.body?.language ?? 'python'

  if (language !== 'python') {
    return res.status(400).json({ error: 'Only python is supported' })
  }
  if (!code || code.length === 0) {
    return res.status(400).json({ error: 'Code is required' })
  }
  if (code.length > LIMITS.maxCodeBytes) {
    return res.status(400).json({ error: 'Code too large' })
  }

  try {
    const result = await runInSandbox(code)
    return res.json(result)
  } catch (err) {
    console.error('execute failed:', err)
    return res.status(500).json({ error: 'Execution failed' })
  }
})

app.listen(PORT, () => {
  console.log(`exec-server listening on http://localhost:${PORT}`)
})

// =============================================================================
// runInSandbox — the security-critical bit
// =============================================================================
// Pipeline:
//   1. Create the container with all hardening flags.
//   2. Attach to its stdio so we can stream stdin in / stdout+stderr out.
//   3. Start the container; write the user code to stdin; close stdin.
//   4. Race the container's exit against a wall-clock timer.
//   5. Whichever wins, capture output and (always) remove the container.
//
// We deliberately do NOT bind-mount user code in from the host. Instead we
// pipe the code into stdin and let Python read from there. Why:
//   - No host file is created → no path/race-condition hazards.
//   - No filesystem traversal angle.
//   - The container is genuinely write-once: --read-only + tmpfs covers the
//     only place anything can ever be written.

type ExecResult = {
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  timedOut: boolean
  truncated: boolean
}

async function runInSandbox(code: string): Promise<ExecResult> {
  const containerName = `nebula-exec-${randomUUID()}`
  const startTime = Date.now()

  // -------------------------------------------------------------------------
  // Container creation. Every option below is intentional — read the comments.
  // -------------------------------------------------------------------------
  const container = await docker.createContainer({
    name: containerName,
    Image: DOCKER_IMAGE,

    Cmd: ['python3', '-u', '-'],

    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    OpenStdin: true,
    StdinOnce: true,
    Tty: false,

    User: 'runner:runner',
    NetworkDisabled: true,

    HostConfig: {
      ReadonlyRootfs: true,
      Tmpfs: {
        '/tmp': `rw,noexec,nosuid,size=${LIMITS.tmpfsBytes},mode=1777`,
      },
      Memory: LIMITS.memoryBytes,
      MemorySwap: LIMITS.memoryBytes,
      NanoCpus: Math.floor(LIMITS.cpus * 1e9),
      PidsLimit: LIMITS.pidsLimit,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      AutoRemove: true,
    },
  })

  // -------------------------------------------------------------------------
  // Output capture: two PassThrough streams that the demuxer will write to.
  // We attach 'data' listeners that build up byte buffers, capped at our
  // max output size so a runaway `while True: print('x')` can't OOM us.
  // -------------------------------------------------------------------------
  const stdoutStream = new PassThrough()
  const stderrStream = new PassThrough()

  let stdoutBytes = 0
  let stderrBytes = 0
  let truncated = false
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []

  stdoutStream.on('data', (chunk: Buffer) => {
    if (stdoutBytes >= LIMITS.maxOutputBytes) {
      truncated = true
      return
    }
    const remaining = LIMITS.maxOutputBytes - stdoutBytes
    if (chunk.length > remaining) {
      stdoutChunks.push(chunk.subarray(0, remaining))
      stdoutBytes += remaining
      truncated = true
    } else {
      stdoutChunks.push(chunk)
      stdoutBytes += chunk.length
    }
  })
  stderrStream.on('data', (chunk: Buffer) => {
    if (stderrBytes >= LIMITS.maxOutputBytes) {
      truncated = true
      return
    }
    const remaining = LIMITS.maxOutputBytes - stderrBytes
    if (chunk.length > remaining) {
      stderrChunks.push(chunk.subarray(0, remaining))
      stderrBytes += remaining
      truncated = true
    } else {
      stderrChunks.push(chunk)
      stderrBytes += chunk.length
    }
  })

  // -------------------------------------------------------------------------
  // Start FIRST, then attach. With Cmd: ['python3', '-u', '-'], Python opens
  // stdin and blocks waiting for input — starting first means the process is
  // ready to receive our stdin write.
  // -------------------------------------------------------------------------
  await container.start()

  const stream = await container.attach({
    stream: true,
    stdin: true,
    stdout: true,
    stderr: true,
    hijack: true,
  })

  // Docker multiplexes stdout/stderr in the attach stream, with a header per
  // chunk identifying the channel. demuxStream splits them into our two
  // PassThrough streams. WITHOUT this, the multiplexer header bytes (the
  // JSON-looking blob we saw before) leak into the data.
  container.modem.demuxStream(stream, stdoutStream, stderrStream)

  // Pipe in the code and close stdin (signals EOF to Python).
  stream.write(code)
  stream.end()

  // -------------------------------------------------------------------------
  // Race: container exit vs wall-clock timer.
  // -------------------------------------------------------------------------
  let timedOut = false

  const waitPromise = container.wait()
  const timeoutPromise = new Promise<'TIMEOUT'>((resolve) =>
    setTimeout(() => resolve('TIMEOUT'), LIMITS.wallTimeMs)
  )

  const winner = await Promise.race([
    waitPromise.then((r) => ({ kind: 'EXIT' as const, result: r })),
    timeoutPromise.then(() => ({ kind: 'TIMEOUT' as const })),
  ])

  let exitCode: number | null = null

  if (winner.kind === 'TIMEOUT') {
    timedOut = true
    try {
      await container.kill({ signal: 'SIGKILL' })
    } catch {
      // Already exited; AutoRemove cleans up.
    }
    try {
      const finalResult = await Promise.race([
        waitPromise,
        new Promise((r) => setTimeout(r, 1000)),
      ])
      if (finalResult && typeof finalResult === 'object' && 'StatusCode' in finalResult) {
        exitCode = (finalResult as { StatusCode: number }).StatusCode
      }
    } catch {
      // ignore
    }
  } else {
    exitCode = winner.result.StatusCode
  }

  // Let the demux flush any final bytes before we read.
  await new Promise((r) => setImmediate(r))

  const stdout = Buffer.concat(stdoutChunks).toString('utf8')
  const stderr = Buffer.concat(stderrChunks).toString('utf8')
  const durationMs = Date.now() - startTime

  return {
    stdout,
    stderr,
    exitCode,
    durationMs,
    timedOut,
    truncated,
  }
}