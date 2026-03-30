import { createServer } from 'node:http'
import { httpServerHandler } from 'cloudflare:node'
import express from 'express'
import { TinaNodeBackend, LocalBackendAuthProvider } from '@tinacms/datalayer'
import { createClerkClient } from '@clerk/backend'
import { env } from 'cloudflare:workers'
import databaseClient from '../tina/__generated__/databaseClient'
import database from '../tina/database'
import { level, injectD1 } from '../tina/database'

injectD1(env.DB)
import graphqlSchema from '../tina/__generated__/_graphql.json'
import tinaSchema from '../tina/__generated__/_schema.json'
import lookup from '../tina/__generated__/_lookup.json'

let dbOpenPromise: Promise<void> | null = null
const ensureDbOpen = () => {
  if (!dbOpenPromise) dbOpenPromise = level.open()
  return dbOpenPromise
}

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true'

const clerk = createClerkClient({ secretKey: env.CLERK_SECRET, publishableKey: env.TINA_PUBLIC_CLERK_PUBLIC_KEY })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clerkIsAuthorized = async (req: any) => {
  const token = (req.headers['authorization'] ?? '').replace('Bearer ', '').trim()
  if (!token) return { isAuthorized: false as const, errorCode: 401, errorMessage: 'Unauthorized' }
  try {
    const state = await clerk.authenticateRequest(
      new Request('https://tina-worker/', { headers: { authorization: `Bearer ${token}` } }),
      { secretKey: env.CLERK_SECRET, publishableKey: env.TINA_PUBLIC_CLERK_PUBLIC_KEY },
    )
    if (state.status === 'signed-in') return { isAuthorized: true as const }
  } catch { /* fall through */ }
  return { isAuthorized: false as const, errorCode: 401, errorMessage: 'Unauthorized' }
}

const authProvider = isLocal ? LocalBackendAuthProvider() : { isAuthorized: clerkIsAuthorized }

const tinaHandler = TinaNodeBackend({
  authProvider,
  databaseClient,
  options: { basePath: 'tina' },
})

const app = express()
// Capture raw body for GitHub webhook HMAC verification before JSON parsing consumes it
app.use(express.json({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  verify: (req: any, _res, buf) => { req.rawBody = buf },
}))
app.use(async (_req, _res, next) => { await ensureDbOpen(); next() })

app.get('/img', async (req, res) => {
  const src = typeof req.query.src === 'string' ? req.query.src : ''
  // Validate: only allow paths within uploads/, no traversal
  if (!src || src.includes('..') || !src.startsWith('uploads/')) {
    res.status(400).json({ error: 'invalid src' })
    return
  }

  const w = req.query.w ? Number(req.query.w) : undefined
  const h = req.query.h ? Number(req.query.h) : undefined
  const q = req.query.q ? Number(req.query.q) : 85
  const format = typeof req.query.format === 'string' ? req.query.format : 'webp'
  const fit = typeof req.query.fit === 'string' ? req.query.fit : 'scale-down'

  const host = req.headers.host || ''
  const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.startsWith('[::1]')

  if (isLocal) {
    // Local dev: CF image transformation unavailable — serve raw asset
    res.redirect(`/${src}`)
    return
  }

  const assetUrl = `https://${host}/${src}`
  try {
    const imageOptions: Record<string, unknown> = { quality: q, format, fit }
    if (w) imageOptions.width = w
    if (h) imageOptions.height = h

    const transformed = await fetch(assetUrl, {
      cf: { image: imageOptions },
      // Prevent loops if this request comes back through the worker
      headers: { 'x-img-transform': '1' },
    } as RequestInit)

    if (!transformed.ok) { res.status(transformed.status).end(); return }

    const body = await transformed.arrayBuffer()
    res.setHeader('Content-Type', transformed.headers.get('content-type') || 'image/webp')
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.send(Buffer.from(body))
  } catch (err) {
    console.error('[img] transform error:', err)
    res.redirect(`/${src}`)
  }
})

// GitHub webhook → instant reindex on push (no 6h cron delay)
app.post('/tina/webhook', async (req, res) => {
  const sig = req.headers['x-hub-signature-256'] as string
  const secret = env.GITHUB_WEBHOOK_SECRET
  if (!sig || !secret) { res.status(401).end(); return }

  // Verify HMAC-SHA256 signature over raw body
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawBody: Buffer = (req as any).rawBody ?? Buffer.from(JSON.stringify(req.body))
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const hmac = await crypto.subtle.sign('HMAC', key, rawBody)
  const expected = 'sha256=' + Array.from(new Uint8Array(hmac)).map(b => b.toString(16).padStart(2, '0')).join('')
  if (expected !== sig) { res.status(401).end(); return }

  // Only reindex pushes to the configured branch
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = (req.body as any)?.ref as string | undefined
  const branch = process.env.GITHUB_BRANCH || 'main'
  if (ref && ref !== `refs/heads/${branch}`) { res.json({ skipped: true }); return }

  try {
    await (database as any).indexContent({ graphQLSchema: graphqlSchema, tinaSchema: { schema: tinaSchema }, lookup })
    res.json({ ok: true })
  } catch (err) {
    console.error('[webhook] reindex error:', err)
    res.status(500).json({ error: String(err) })
  }
})

app.post('/tina/index', async (req, res) => {
  const auth = await clerkIsAuthorized(req)
  if (!auth.isAuthorized) { res.status(401).json({ error: 'Unauthorized' }); return }
  try {
    await (database as any).indexContent({ graphQLSchema: graphqlSchema, tinaSchema: { schema: tinaSchema }, lookup })
    res.json({ ok: true })
  } catch (err) {
    console.error('[index] error:', (err as any)?.stack || String(err))
    res.status(500).json({ error: String(err) })
  }
})

app.use((req, res) => {
  tinaHandler(req, res).catch(err => {
    res.status(500).json({ error: String(err) })
  })
})

const server = createServer(app)
server.listen(3000)

export default {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...httpServerHandler(server as any),

  async scheduled(_controller: ScheduledController): Promise<void> {
    try {
      await ensureDbOpen()
      await (database as any).indexContent({ graphQLSchema: graphqlSchema, tinaSchema: { schema: tinaSchema }, lookup })
    } catch (err) {
      console.error('Scheduled reindex failed:', err)
    }
  },
} satisfies ExportedHandler
