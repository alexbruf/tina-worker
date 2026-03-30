// TinaCMS backend API route for Next.js via @opennextjs/cloudflare.
//
// Setup:
//   1. wrangler.jsonc — add:
//      "compatibility_date": "2025-09-15"
//      "compatibility_flags": ["nodejs_compat"]
//      "d1_databases": [{ "binding": "DB", "database_name": "tina-db", "database_id": "..." }]
//   2. Secrets: wrangler secret put CLERK_SECRET
//              wrangler secret put GITHUB_PERSONAL_ACCESS_TOKEN
//   3. In tina/config.ts: contentApiUrlOverride: '/api/tina/gql'
//   4. Run: tinacms build
//   5. Local dev: next dev with TINA_PUBLIC_IS_LOCAL=true (uses local filesystem, no D1/GitHub)
//   6. Deploy: npx @opennextjs/cloudflare build && wrangler deploy
//      (wrangler.jsonc must have: "main": ".open-next/worker.js")

import { TinaNodeBackend, LocalBackendAuthProvider } from '@tinacms/datalayer'
import { createClerkClient } from '@clerk/backend'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import databaseClient from '../../../tina/__generated__/databaseClient'
import { injectD1 } from '../../../tina/database'
import type { NextApiRequest, NextApiResponse } from 'next'

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true'

const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET!,
  publishableKey: process.env.TINA_PUBLIC_CLERK_PUBLIC_KEY!,
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clerkIsAuthorized = async (req: any) => {
  // req is a Node IncomingMessage here — bracket access works
  const authHeader: string = req.headers?.get?.('authorization') ?? req.headers?.['authorization'] ?? ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) return { isAuthorized: false as const, errorCode: 401, errorMessage: 'Unauthorized' }
  try {
    const state = await clerk.authenticateRequest(
      new Request('https://placeholder/', { headers: { authorization: `Bearer ${token}` } }),
      { secretKey: process.env.CLERK_SECRET!, publishableKey: process.env.TINA_PUBLIC_CLERK_PUBLIC_KEY! },
    )
    if (state.status === 'signed-in') return { isAuthorized: true as const }
  } catch { /* fall through */ }
  return { isAuthorized: false as const, errorCode: 401, errorMessage: 'Unauthorized' }
}

const handler = TinaNodeBackend({
  authProvider: isLocal ? LocalBackendAuthProvider() : { isAuthorized: clerkIsAuthorized },
  databaseClient,
})

export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (!isLocal) {
    const { env } = await getCloudflareContext()
    injectD1(env.DB)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return handler(req as any, res as any)
}

export const config = {
  api: {
    bodyParser: false, // TinaNodeBackend handles its own body parsing
  },
}
