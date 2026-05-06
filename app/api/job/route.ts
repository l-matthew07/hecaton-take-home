import { NextRequest } from 'next/server'
import { runSearchJob } from '../../../lib/jobs/runSearchJob'
import { SSEEvent } from '../../../lib/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
    const encoder = new TextEncoder()
    const abort = new AbortController()
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null
    let closed = false

    // Abort the job when the client disconnects
    req.signal.addEventListener('abort', () => {
        closed = true
        abort.abort()
    })

    function send(event: SSEEvent) {
        if (closed || !controller) return
        try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
            closed = true
        }
    }

    const stream = new ReadableStream<Uint8Array>({
        start(c) {
            controller = c
            runSearchJob(send, abort.signal)
                .catch(() => send({ type: 'done' }))
                .finally(() => {
                    if (!closed) {
                        try { c.close() } catch { /* already closed */ }
                        closed = true
                    }
                })
        },
        cancel() {
            closed = true
            abort.abort()
        },
    })

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    })
}
