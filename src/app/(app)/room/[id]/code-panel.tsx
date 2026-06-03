// src/app/room/[id]/code-panel.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import * as Y from 'yjs'
import { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider'
import type { editor } from 'monaco-editor'
import { Button } from '@/components/ui/button'

// Same dynamic import pattern as before — Monaco is browser-only.
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
      Loading editor…
    </div>
  ),
})

type ExecResult = {
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  timedOut: boolean
  truncated: boolean
  runnerName?: string
  runAt?: number
}

export function CodePanel({
  roomId,
  codeSessionId,
  token,
  user,
}: {
  roomId: string
  codeSessionId: string
  token: string
  user: { id: string; name: string }
}) {
  // ───────────────────────────────────────────────────────────────────────
  // The Y.Doc holds BOTH the code text AND the output. Same doc, same
  // server, same auth — one connection covers both. The two shared types:
  //   ydoc.getText('code')   ← bound to Monaco via y-monaco
  //   ydoc.getMap('output')  ← written on Run, observed by all peers
  // ───────────────────────────────────────────────────────────────────────
  const ydoc = useMemo(() => new Y.Doc(), [codeSessionId])

  const provider = useMemo(() => {
    return new HocuspocusProvider({
      url: process.env.NEXT_PUBLIC_WS_URL!,
      name: `code:${codeSessionId}`, // ← matches the server's parseDocumentName
      document: ydoc,
      token,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeSessionId, ydoc])

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      provider.destroy()
      ydoc.destroy()
    }
  }, [provider, ydoc])

  // ───────────────────────────────────────────────────────────────────────
  // Monaco binding. Lazy — we only attach y-monaco after Monaco has actually
  // mounted, because y-monaco needs the editor instance.
  // ───────────────────────────────────────────────────────────────────────
  const [bindingReady, setBindingReady] = useState(false)

  function handleEditorMount(
    editorInstance: editor.IStandaloneCodeEditor
  ) {
    // Lazy-import y-monaco so it's not in the SSR bundle.
    import('y-monaco').then(({ MonacoBinding }) => {
      const yText = ydoc.getText('code')
      // The binding maps Monaco's model edits to Y.Text ops and vice versa.
      // The last arg ties the binding to this editor's awareness for cursors;
      // we pass the provider's awareness so other peers see our caret.
      new MonacoBinding(
        yText,
        editorInstance.getModel()!,
        new Set([editorInstance]),
        provider.awareness
      )
      setBindingReady(true)
    })
  }

  // ───────────────────────────────────────────────────────────────────────
  // Output subscription. The Y.Map at 'output' is updated by whoever runs
  // code; everyone else observes it via the .observe() callback.
  // ───────────────────────────────────────────────────────────────────────
  const [output, setOutput] = useState<ExecResult | null>(null)

  useEffect(() => {
  const outputMap = ydoc.getMap('output')

  const readMap = (): ExecResult | null => {
    if (outputMap.size === 0) return null
    return {
      stdout: (outputMap.get('stdout') as string) ?? '',
      stderr: (outputMap.get('stderr') as string) ?? '',
      exitCode: (outputMap.get('exitCode') as number | null) ?? null,
      durationMs: (outputMap.get('durationMs') as number) ?? 0,
      timedOut: !!outputMap.get('timedOut'),
      truncated: !!outputMap.get('truncated'),
      runnerName: outputMap.get('runnerName') as string | undefined,
      runAt: outputMap.get('runAt') as number | undefined,
    }
  }

  console.log('[CodePanel] output effect ran. initial map size:', outputMap.size)
  setOutput(readMap())
  
  const handler = () => {
    console.log('[CodePanel] output map changed! size:', outputMap.size, 'stdout:', outputMap.get('stdout'))
    setOutput(readMap())
  }
  outputMap.observe(handler)
  return () => outputMap.unobserve(handler)
}, [ydoc])

  // ───────────────────────────────────────────────────────────────────────
  // Connection status (same pattern as the note editor).
  // ───────────────────────────────────────────────────────────────────────
  const [status, setStatus] = useState<WebSocketStatus>(
    WebSocketStatus.Connecting
  )
  useEffect(() => {
    const onStatus = ({ status }: { status: WebSocketStatus }) =>
      setStatus(status)
    provider.on('status', onStatus)
    return () => {
      provider.off('status', onStatus)
    }
  }, [provider])
  // ───────────────────────────────────────────────────────────────────────
  // Run: pull current code from Y.Text, POST to /api/run, write result
  // into the Y.Map. Yjs syncs the map update to all peers automatically.
  // ───────────────────────────────────────────────────────────────────────
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRun() {
    setRunning(true)
    setError(null)

    const code = ydoc.getText('code').toString()

    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, roomId, language: 'python' }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `Request failed (${res.status})`)
        return
      }

      const data = (await res.json()) as ExecResult

      // Write the result into the shared Y.Map. transact() batches the
      // writes so they sync to peers as one update, not seven.
      const outputMap = ydoc.getMap('output')
      ydoc.transact(() => {
        outputMap.set('stdout', data.stdout)
        outputMap.set('stderr', data.stderr)
        outputMap.set('exitCode', data.exitCode)
        outputMap.set('durationMs', data.durationMs)
        outputMap.set('timedOut', data.timedOut)
        outputMap.set('truncated', data.truncated)
        outputMap.set('runnerName', user.name)
        outputMap.set('runAt', Date.now())
      })
      console.log('[CodePanel] wrote output. map size after write:', outputMap.size, 'stdout:', outputMap.get('stdout'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Python sandbox</h2>
        <div className="flex items-center gap-3">
          <ConnectionDot status={status} />
          <Button onClick={handleRun} disabled={running || !bindingReady} size="sm">
            {running ? 'Running…' : 'Run'}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <MonacoEditor
          height="280px"
          defaultLanguage="python"
          theme="vs-dark"
          // No `value` prop — y-monaco owns the content. Setting value here
          // would fight the binding. Just provide a default for an empty doc.
          defaultValue=""
          onMount={handleEditorMount}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false,
            quickSuggestions: false,
          }}
        />
      </div>

      <OutputPanel output={output} error={error} running={running} />
    </section>
  )
}

function OutputPanel({
  output,
  error,
  running,
}: {
  output: ExecResult | null
  error: string | null
  running: boolean
}) {
  if (running) {
    return (
      <pre className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
        Running in sandbox…
      </pre>
    )
  }
  if (error) {
    return (
      <pre className="rounded-lg border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
        {error}
      </pre>
    )
  }
  if (!output) {
    return (
      <pre className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
        Output will appear here. Anyone in the room can run the code.
      </pre>
    )
  }

  const exitNote = output.timedOut
    ? `Timed out after ${output.durationMs}ms`
    : `Exited with code ${output.exitCode} in ${output.durationMs}ms`

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2 text-xs font-mono">
      {output.runnerName && (
        <p className="text-muted-foreground">
          Last run by {output.runnerName}
          {output.runAt && ` at ${new Date(output.runAt).toLocaleTimeString()}`}
        </p>
      )}
      {output.stdout && (
        <pre className="whitespace-pre-wrap text-foreground">{output.stdout}</pre>
      )}
      {output.stderr && (
        <pre className="whitespace-pre-wrap text-destructive">{output.stderr}</pre>
      )}
      {!output.stdout && !output.stderr && (
        <pre className="text-muted-foreground">(no output)</pre>
      )}
      <p className="text-muted-foreground">
        {exitNote}
        {output.truncated && ' • output truncated'}
      </p>
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
    </div>
  )
}