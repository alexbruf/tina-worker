/**
 * Adapts a Node.js-style (req, res) handler to work with Web Request/Response.
 *
 * TinaNodeBackend returns (req: IncomingMessage, res: ServerResponse) => Promise<void>.
 * React Router on Cloudflare gives us Web Request and expects Web Response.
 *
 * Instead of using real node:http classes (which may not work fully in workerd),
 * we create lightweight mock objects that satisfy what TinaCMS actually reads/writes.
 */

type NodeHandler = (req: any, res: any) => Promise<void>

export async function callNodeHandler(handler: NodeHandler, request: Request): Promise<Response> {
  const url = new URL(request.url)

  // Read the body upfront
  let body: any = undefined
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const text = await request.text()
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }

  // Create a minimal req mock that satisfies TinaNodeBackend
  const req = {
    method: request.method,
    url: url.pathname + url.search,
    headers: Object.fromEntries(request.headers),
    body,
    // Some code paths may read these
    connection: {},
    socket: {},
  }

  // Create a minimal res mock that captures the response
  let statusCode = 200
  let statusMessage = 'OK'
  const responseHeaders: Record<string, string | string[]> = {}
  const chunks: string[] = []
  let resolved = false

  return new Promise<Response>((resolve) => {
    const res = {
      get statusCode() { return statusCode },
      set statusCode(code: number) { statusCode = code },
      get statusMessage() { return statusMessage },
      set statusMessage(msg: string) { statusMessage = msg },

      setHeader(name: string, value: string | string[]) {
        responseHeaders[name.toLowerCase()] = value
      },
      getHeader(name: string) {
        return responseHeaders[name.toLowerCase()]
      },
      removeHeader(name: string) {
        delete responseHeaders[name.toLowerCase()]
      },
      writeHead(code: number, headers?: Record<string, string>) {
        statusCode = code
        if (headers) {
          for (const [k, v] of Object.entries(headers)) {
            responseHeaders[k.toLowerCase()] = v
          }
        }
        return res
      },

      write(chunk: any) {
        if (chunk != null) chunks.push(typeof chunk === 'string' ? chunk : chunk.toString())
        return true
      },

      end(chunk?: any) {
        if (chunk != null) chunks.push(typeof chunk === 'string' ? chunk : chunk.toString())

        if (!resolved) {
          resolved = true
          const headers = new Headers()
          for (const [key, value] of Object.entries(responseHeaders)) {
            if (Array.isArray(value)) {
              for (const v of value) headers.append(key, v)
            } else if (value != null) {
              headers.set(key, String(value))
            }
          }

          const responseBody = chunks.join('')
          resolve(new Response(responseBody || null, {
            status: statusCode,
            headers,
          }))
        }
        return res
      },

      // Some code paths check if res is writable
      writableEnded: false,
      headersSent: false,
      finished: false,
    }

    handler(req, res).catch((err: Error) => {
      if (!resolved) {
        resolved = true
        resolve(new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }))
      }
    })
  })
}
