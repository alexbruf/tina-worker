// Catch-all API route for TinaCMS backend: handles /api/tina/gql, /api/tina/auth/*, etc.
//
// Setup:
//   1. Install: @astrojs/cloudflare adapter
//      astro.config.mjs: adapter: cloudflare({ platformProxy: { enabled: true } })
//   2. Add to wrangler.jsonc:
//      "compatibility_date": "2025-09-15"
//      "compatibility_flags": ["nodejs_compat"]
//      "d1_databases": [{ "binding": "DB", "database_name": "tina-db", "database_id": "..." }]
//   3. Secrets: wrangler secret put CLERK_SECRET
//              wrangler secret put GITHUB_PERSONAL_ACCESS_TOKEN
//   4. In tina/config.ts: contentApiUrlOverride: '/api/tina/gql'
//   5. Run: tinacms build

import type { APIRoute } from 'astro'
import { TinaNodeBackend, LocalBackendAuthProvider } from '@tinacms/datalayer'
import { createClerkClient } from '@clerk/backend'
import databaseClient from '../../../../tina/__generated__/databaseClient'
import { injectD1 } from '../../../../tina/database'

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true'

const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET!,
  publishableKey: process.env.TINA_PUBLIC_CLERK_PUBLIC_KEY!,
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clerkIsAuthorized = async (req: any) => {
  // req is a Web Request in this context — use headers.get()
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

// Disable prerendering — this route must be SSR.
// The rest of your Astro site can remain static/prerendered.
export const prerender = false

export const ALL: APIRoute = async ({ request, locals }) => {
  if (!isLocal) {
    // Astro 5: locals.runtime.env holds Cloudflare bindings
    // Astro 6+: can also use `import { env } from 'cloudflare:workers'`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    injectD1((locals as any).runtime.env.DB)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (handler as any)(request)
}
