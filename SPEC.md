# TinaCMS Backend on Cloudflare — Integration Plan

## Understanding the TinaCMS Backend

The TinaCMS self-hosted backend is a **single API endpoint** that handles three things: GraphQL queries/mutations against the content index, authentication, and Git sync (commits to GitHub on writes). It's created via `TinaNodeBackend()` which returns a `(req, res) => void` handler — a classic Node.js-style callback signature.

The handler internally routes based on the URL path under `/api/tina/`:
- `/api/tina/gql` — GraphQL endpoint (reads/writes content via the Level database)
- `/api/tina/auth/*` — Auth routes (login, callback, session, etc.)
- `/api/tina/admin/*` — Admin endpoints

The three pluggable modules are:
1. **Database adapter** — an `abstract-level` implementation (this is `d1-level`)
2. **Git provider** — commits content changes to GitHub via Octokit (pure HTTP, no Node `fs`)
3. **Auth provider** — Auth.js, Clerk, TinaCloud, or custom

The `databaseClient` is a generated module (`tina/__generated__/databaseClient`) that wraps the Level instance with TinaCMS's schema and indexing logic.

## The Core ~~Problem~~ Non-Problem

`TinaNodeBackend()` returns a handler with a Node.js `(req: IncomingMessage, res: ServerResponse)` signature. Cloudflare Workers historically used only the Web standard `Request`/`Response` API, which would have required a shim.

**This is no longer an issue.** As of September 2025, Cloudflare Workers natively supports `node:http` server APIs — including `IncomingMessage`, `ServerResponse`, and `createServer` — via the `enable_nodejs_http_server_modules` flag. This is automatically enabled when you set `nodejs_compat` with a compatibility date of `2025-08-15` or later. The implementation wraps Workers' native fetch API under the hood, so there's no performance penalty.

**What this means:** `TinaNodeBackend(req, res)` should work directly on Cloudflare Workers with zero shim code. Just set:

```jsonc
{
  "compatibility_date": "2025-09-15",
  "compatibility_flags": ["nodejs_compat"]
}
```

Additionally, `process.env` is now automatically populated from Worker bindings/vars (via `nodejs_compat_populate_process_env`), so TinaCMS's `process.env.GITHUB_OWNER` etc. reads just work too.

## (A) Standalone TinaCMS Worker

A dedicated Cloudflare Worker that runs nothing but the TinaCMS backend. The frontend (your actual site) is deployed separately and points its `contentApiUrlOverride` to this Worker's URL.

### Architecture

```
┌─────────────────────────────────────────────┐
│           tina-backend Worker               │
│                                             │
│  Hono router                                │
│    POST /tina/gql    → TinaNodeBackend      │
│    ALL  /tina/auth/* → TinaNodeBackend      │
│    ALL  /tina/admin/*→ TinaNodeBackend      │
│                                             │
│  Bindings:                                  │
│    DB: D1Database (content index)           │
│                                             │
│  Env vars:                                  │
│    GITHUB_OWNER, GITHUB_REPO,               │
│    GITHUB_PERSONAL_ACCESS_TOKEN,            │
│    GITHUB_BRANCH, NEXTAUTH_SECRET           │
├─────────────────────────────────────────────┤
│  D1 database (kv table)                     │
└─────────────────────────────────────────────┘
```

### Worker entry point

```typescript
// src/index.ts
import { Hono } from 'hono'
import { TinaNodeBackend } from '@tinacms/datalayer'
import { AuthJsBackendAuthProvider, TinaAuthJSOptions } from 'tinacms-authjs'
import databaseClient from '../tina/__generated__/databaseClient'

type Env = { DB: D1Database; [key: string]: string }

const app = new Hono<{ Bindings: Env }>()

app.all('/tina/*', async (c) => {
  // Inject D1 binding before TinaCMS touches the database
  globalThis.__d1 = c.env.DB

  const handler = TinaNodeBackend({
    authentication: AuthJsBackendAuthProvider({
      authOptions: TinaAuthJSOptions({
        databaseClient,
        secret: c.env.NEXTAUTH_SECRET,
      }),
    }),
    databaseClient,
  })

  return handler(c.req.raw, c.res)
})

export default app
```

### How the wiring actually works in TinaCMS (and the D1 challenge)

The official self-hosted setup has three files:

**File 1: `tina/database.ts`** — static default export. This is where the Level adapter and Git provider are configured:

```typescript
// Official pattern (Vercel KV / Upstash example from docs)
import { createDatabase, createLocalDatabase } from '@tinacms/datalayer'
import { GitHubProvider } from 'tinacms-gitprovider-github'
import { Redis } from '@upstash/redis'
import { RedisLevel } from 'upstash-redis-level'

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true'
const branch = process.env.GITHUB_BRANCH || 'main'

export default isLocal
  ? createLocalDatabase()
  : createDatabase({
      gitProvider: new GitHubProvider({
        repo: process.env.GITHUB_REPO,
        owner: process.env.GITHUB_OWNER,
        token: process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
        branch,
      }),
      databaseAdapter: new RedisLevel({
        redis: new Redis({
          url: process.env.KV_REST_API_URL,
          token: process.env.KV_REST_API_TOKEN,
        }),
        namespace: branch,
      }),
    })
```

**File 2: `tina/__generated__/databaseClient`** — auto-generated by `tinacms build`. Imports the default export from `tina/database.ts` and wraps it with schema/indexing logic. You never edit this file.

**File 3: `pages/api/tina/[...routes].ts`** — the API handler. Imports the generated `databaseClient` and passes it to `TinaNodeBackend`:

```typescript
import { TinaNodeBackend, LocalBackendAuthentication } from '@tinacms/datalayer'
import { AuthJsBackendAuthentication, TinaAuthJSOptions } from 'tinacms-authjs'
import databaseClient from '../../../tina/__generated__/databaseClient'

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true'

const handler = TinaNodeBackend({
  authentication: isLocal
    ? LocalBackendAuthentication()
    : AuthJsBackendAuthentication({
        authOptions: TinaAuthJSOptions({
          databaseClient,
          secret: process.env.NEXTAUTH_SECRET,
        }),
      }),
  databaseClient,
})

export default (req, res) => handler(req, res)
```

**The Cloudflare D1 challenge:** `tina/database.ts` is a **static default export** — it runs at module load time. Upstash Redis works fine with this because it's initialized via URL + token (environment variables available at load time). But D1 requires a Worker binding (`env.DB`) that only exists at **request time**.

### D1 binding injection pattern

The solution is a `globalThis` injection. Set the D1 binding on `globalThis` in the request handler *before* any database operations run. `D1Level` reads from `globalThis` lazily on first use (in `_open()`), not in the constructor.

**`tina/database.ts` for Cloudflare D1:**

```typescript
import { createDatabase, createLocalDatabase } from '@tinacms/datalayer'
import { GitHubProvider } from 'tinacms-gitprovider-github'
import { D1Level } from 'd1-level'

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true'
const branch = process.env.GITHUB_BRANCH || 'main'

export default isLocal
  ? createLocalDatabase()
  : createDatabase({
      gitProvider: new GitHubProvider({
        repo: process.env.GITHUB_REPO,
        owner: process.env.GITHUB_OWNER,
        token: process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
        branch,
      }),
      // D1Level reads globalThis.__d1 lazily on _open(), not in constructor.
      // The Worker handler sets globalThis.__d1 = env.DB before each request.
      databaseAdapter: new D1Level({
        namespace: branch,
      }),
    })
```

**In `D1Level`'s implementation**, the constructor stores config but doesn't touch D1. The `_open()` method (called lazily on first operation) reads `globalThis.__d1`:

```typescript
// Inside d1-level — constructor does NOT require d1 binding
class D1Level extends AbstractLevel {
  constructor(options: { d1?: D1Database; namespace?: string }) {
    super(/* ... */)
    this._d1 = options.d1 ?? null
    this._namespace = options.namespace ?? ''
  }

  async _open() {
    // Resolve D1 binding: explicit > globalThis > error
    if (!this._d1) {
      this._d1 = globalThis.__d1
    }
    if (!this._d1) {
      throw new Error('D1 binding not found. Set globalThis.__d1 = env.DB in your Worker handler.')
    }
    // CREATE TABLE IF NOT EXISTS ...
  }
}
```

**In the Worker handler**, the injection happens before TinaCMS runs:

```typescript
app.all('/tina/*', async (c) => {
  globalThis.__d1 = c.env.DB  // ← this line is the entire glue
  return handler(c.req.raw, c.res)
})
```

This is safe because Workers are single-threaded — there's no race condition between setting the global and the database reading it. The pattern is identical to how many Cloudflare D1 libraries handle binding injection in framework contexts.

### Cron-based reindex

TinaCMS rebuilds its index from Git when the database is empty. But for ongoing sync (e.g., someone pushes directly to Git without going through the CMS), you'd want a periodic reindex. A Cloudflare Cron Trigger is perfect for this:

```typescript
// In the worker
export default {
  async fetch(request: Request, env: Env) { ... },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    globalThis.__d1 = env.DB
    // Trigger a reindex from Git — databaseClient reads from globalThis.__d1
    await databaseClient.indexContent({ /* options */ })
  }
}
```

```jsonc
// wrangler.jsonc
{
  "triggers": {
    "crons": ["0 */6 * * *"]  // every 6 hours
  }
}
```

---

## (B) Attaching to Framework Apps on Cloudflare

In these scenarios, TinaCMS runs as an API route inside your existing framework app — not as a separate Worker. This is how the Next.js/Vercel setup works today.

### React Router v7 on Cloudflare Workers

React Router v7 on Cloudflare uses the Cloudflare Vite plugin. The Worker entry is `workers/app.ts`, and bindings are available via `context.cloudflare.env` in loaders/actions.

**How to wire TinaCMS:**

Create a catch-all route for the Tina API:

```typescript
// app/routes/api.tina.$.tsx (catch-all route)
import type { Route } from './+types/api.tina.$'
import { TinaNodeBackend, LocalBackendAuthentication } from '@tinacms/datalayer'
import { AuthJsBackendAuthentication, TinaAuthJSOptions } from 'tinacms-authjs'
import databaseClient from '../../tina/__generated__/databaseClient'

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true'

const handler = TinaNodeBackend({
  authentication: isLocal
    ? LocalBackendAuthentication()
    : AuthJsBackendAuthentication({
        authOptions: TinaAuthJSOptions({ databaseClient, secret: process.env.NEXTAUTH_SECRET }),
      }),
  databaseClient,
})

export async function action({ request, context }: Route.ActionArgs) {
  globalThis.__d1 = context.cloudflare.env.DB
  return handler(request)
}

export async function loader({ request, context }: Route.LoaderArgs) {
  globalThis.__d1 = context.cloudflare.env.DB
  return handler(request)
}
```

```jsonc
// wrangler.jsonc — add D1 binding
{
  "d1_databases": [{ "binding": "DB", "database_name": "tina-db", "database_id": "..." }]
}
```

```typescript
// tina/config.ts
export default defineConfig({
  contentApiUrlOverride: '/api/tina/gql',
  // ...
})
```

**Access to bindings:** React Router v7 on Cloudflare gives you `context.cloudflare.env` in loaders/actions, which includes `env.DB`. Set `globalThis.__d1 = env.DB` before calling the handler. The Vite plugin fully emulates D1 locally.

**Advantages:** Single deployment, single Worker, shared auth. Your site and CMS are one unit. D1 binding is co-located.

### Astro on Cloudflare Workers

Astro 5+ on Cloudflare uses `@astrojs/cloudflare` adapter. Bindings are accessed via:
- Astro 5: `Astro.locals.runtime.env.DB`
- Astro 6+: `import { env } from 'cloudflare:workers'` (new pattern)

**How to wire TinaCMS:**

Create an API endpoint:

```typescript
// src/pages/api/tina/[...routes].ts
import type { APIRoute } from 'astro'
import { TinaNodeBackend, LocalBackendAuthentication } from '@tinacms/datalayer'
import { AuthJsBackendAuthentication, TinaAuthJSOptions } from 'tinacms-authjs'
import databaseClient from '../../../tina/__generated__/databaseClient'

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true'

const handler = TinaNodeBackend({
  authentication: isLocal
    ? LocalBackendAuthentication()
    : AuthJsBackendAuthentication({
        authOptions: TinaAuthJSOptions({ databaseClient, secret: process.env.NEXTAUTH_SECRET }),
      }),
  databaseClient,
})

export const ALL: APIRoute = async ({ request, locals }) => {
  // Astro 5: locals.runtime.env.DB
  // Astro 6+: import { env } from 'cloudflare:workers'; env.DB
  globalThis.__d1 = locals.runtime.env.DB
  return handler(request)
}
```

```jsonc
// wrangler.jsonc
{
  "d1_databases": [{ "binding": "DB", "database_name": "tina-db", "database_id": "..." }]
}
```

**Astro-specific note:** You must set `output: 'server'` (or use `export const prerender = false` on the API route) since this needs SSR. The rest of your Astro site can be prerendered — only the `/api/tina/*` routes need to be dynamic.

**Local dev:** The `@astrojs/cloudflare` adapter with `platformProxy: { enabled: true }` gives you local D1 emulation via Wrangler. Works out of the box.

### Next.js on Cloudflare via OpenNext

`@opennextjs/cloudflare` transforms your Next.js app to run on Workers. It supports `nodejs_compat` and uses the Node.js runtime (not Edge). Bindings are accessible via `getCloudflareContext()`.

**How to wire TinaCMS:**

This is the closest to the existing Next.js setup since TinaCMS already ships Next.js support:

```typescript
// pages/api/tina/[...routes].ts (Pages Router — matches TinaCMS docs exactly)
import { TinaNodeBackend, LocalBackendAuthentication } from '@tinacms/datalayer'
import { AuthJsBackendAuthentication, TinaAuthJSOptions } from 'tinacms-authjs'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import databaseClient from '../../../tina/__generated__/databaseClient'

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true'

const handler = TinaNodeBackend({
  authentication: isLocal
    ? LocalBackendAuthentication()
    : AuthJsBackendAuthentication({
        authOptions: TinaAuthJSOptions({ databaseClient, secret: process.env.NEXTAUTH_SECRET }),
      }),
  databaseClient,
})

export default async (req, res) => {
  const { env } = await getCloudflareContext()
  globalThis.__d1 = env.DB
  return handler(req, res)
}
```

```jsonc
// wrangler.jsonc
{
  "main": ".open-next/worker.js",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [{ "binding": "DB", "database_name": "tina-db", "database_id": "..." }]
}
```

**The OpenNext-specific gotcha:** `getCloudflareContext()` is the way to access bindings inside Next.js server code when using `@opennextjs/cloudflare`. It replaces the old `@cloudflare/next-on-pages` `getRequestContext()` pattern. This is well-documented and stable.

**Local dev:** OpenNext recommends using `next dev` for local development (standard Next.js dev server) and only using the OpenNext build for preview/deploy. For local Tina dev, you'd use `TINA_PUBLIC_IS_LOCAL=true` which bypasses the D1 path entirely and uses the local filesystem.

---

## Summary: Effort by Integration Path

| Path | Difficulty | Key Challenge |
|------|-----------|---------------|
| (A) Standalone Worker | Easy-Medium | D1 binding injection pattern, Hono routing |
| (B1) React Router v7 | Easy | Bindings available in loaders, catch-all route is natural |
| (B2) Astro | Easy | API route with `locals.runtime.env`, need SSR on tina routes |
| (B3) Next.js via OpenNext | Easiest | Closest to existing TinaCMS setup, `getCloudflareContext()` |

The shared work across all of these is really just one piece:
1. **`d1-level`** — the database adapter (already planned)

The `node:http` compatibility problem that would have required a shim is fully solved by Workers' native `nodejs_compat` (compatibility_date >= 2025-08-15). `TinaNodeBackend(req, res)` works out of the box.

### Recommended build order

1. Build `d1-level` (and `turso-level`)
2. Wire up the standalone Worker with Hono — prove TinaNodeBackend runs on Workers with `nodejs_compat`
3. Create starter templates for RR7, Astro, and OpenNext (mostly config + one route file each)
