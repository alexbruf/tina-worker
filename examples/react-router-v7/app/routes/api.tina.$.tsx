// Catch-all route for TinaCMS backend: handles /api/tina/gql, /api/tina/auth/*, etc.
//
// Setup:
//   1. Add to wrangler.jsonc:
//      "compatibility_date": "2025-09-15"
//      "compatibility_flags": ["nodejs_compat"]
//      "d1_databases": [{ "binding": "DB", "database_name": "tina-db", "database_id": "..." }]
//   2. Secrets: wrangler secret put CLERK_SECRET
//              wrangler secret put GITHUB_PERSONAL_ACCESS_TOKEN
//   3. In tina/config.ts: contentApiUrlOverride: '/api/tina/gql'
//   4. Run: tinacms build

import { TinaNodeBackend, LocalBackendAuthProvider } from '@tinacms/datalayer'
import { createClerkClient } from '@clerk/backend'
import databaseClient from '../../tina/__generated__/databaseClient'
import { injectD1 } from '../../tina/database'
import { callNodeHandler } from '../lib/node-handler-adapter'
import type { Route } from './+types/api.tina.$'

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true'

const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET!,
  publishableKey: process.env.TINA_PUBLIC_CLERK_PUBLIC_KEY!,
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clerkIsAuthorized = async (req: any) => {
  // req may be IncomingMessage (has req.headers as object) or Web Request
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

export async function action({ request, context }: Route.ActionArgs) {
  injectD1(context.cloudflare.env.DB)
  return callNodeHandler(handler, request)
}

export async function loader({ request, context }: Route.LoaderArgs) {
  injectD1(context.cloudflare.env.DB)
  return callNodeHandler(handler, request)
}
