# TinaCMS + React Router v7 on Cloudflare Workers

Self-hosted TinaCMS with React Router v7, backed by Cloudflare D1 + GitHub + Clerk auth.

## Architecture

```
Browser
  |
  +-- / (React Router SSR, served by Cloudflare Worker)
  +-- /admin/index.html (TinaCMS admin UI, static file)
  +-- /api/tina/gql (GraphQL endpoint, handled by TinaNodeBackend)
        |
        +-- D1 database (content index, via @alexbruf/d1-level)
        +-- GitHub (content storage, via tinacms-gitprovider-github)
        +-- Clerk (authentication, via tinacms-clerk)
```

Key files:
- `tina/config.ts` -- TinaCMS schema and admin UI config
- `tina/database.ts` -- database adapter (D1Level for production, local SQLite for dev)
- `app/routes/api.tina.$.tsx` -- catch-all route wiring TinaNodeBackend to React Router
- `app/lib/node-handler-adapter.ts` -- adapts TinaCMS's Node.js handler to Web Request/Response
- `workers/app.ts` -- Cloudflare Worker entry point
- `src/shims/` -- polyfill shims for Workers compatibility (js-sha1, process, string_decoder)

## Prerequisites

- [Bun](https://bun.sh/) (or Node 18+)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (for deploy)

## Quick start (local mode)

```bash
bunx degit alexbruf/tina-worker/examples/react-router-v7 my-tina-rr7
cd my-tina-rr7
bun install
cp .env.example .env   # defaults to TINA_PUBLIC_IS_LOCAL=true
bun run dev
```

Open http://localhost:5173 for the site and http://localhost:5173/admin/index.html for the CMS.

In local mode (`TINA_PUBLIC_IS_LOCAL=true`), TinaCMS uses a local SQLite database and reads/writes content directly from the filesystem. No D1, GitHub, or Clerk credentials are needed.

## Patches

Three patches are applied via `patchedDependencies` in `package.json`:

- **`@tinacms/graphql@2.2.1`** - Fixes a LevelDB proxy handler that throws on non-function property access (e.g. `parent`, `prefix`, `status`). Required for `d1-level` compatibility.
- **`@tinacms/mdx@1.8.3` / `@2.1.0`** - Adds `workerd` and `worker` export conditions so the correct module entry point is resolved in Cloudflare Workers.

## Deploy to Cloudflare

1. Create a D1 database:
   ```bash
   wrangler d1 create tina-db
   ```
2. Update `wrangler.jsonc`:
   - Set the `database_id` from step 1
   - Set `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`
   - Set `TINA_PUBLIC_CLERK_PUBLIC_KEY`
3. Set secrets:
   ```bash
   wrangler secret put CLERK_SECRET
   wrangler secret put GITHUB_PERSONAL_ACCESS_TOKEN
   ```
4. Build and deploy:
   ```bash
   bun run deploy
   ```

## Workers compatibility notes

TinaCMS was built for Node.js/Vercel. Running it on Cloudflare Workers requires several shims:

- **`js-sha1`** -- aliased to a `node:crypto`-based implementation (`src/shims/js-sha1.ts`)
- **`process/`** and **`string_decoder/`** -- npm polyfill packages used by `readable-stream` (a dependency of `abstract-level`). Aliased to shims that re-export from Node built-ins via `nodejs_compat`
- **`entry.server.tsx`** -- uses `renderToReadableStream` (Web Streams) instead of `renderToPipeableStream` (Node Streams)
- **`node-handler-adapter.ts`** -- bridges TinaNodeBackend's `(req, res)` Node.js API to Web Request/Response
- **`react-router.config.ts`** -- must set `future.v8_viteEnvironmentApi: true` for the Cloudflare Vite plugin

These are configured in `vite.config.ts` via `resolve.alias` and `ssr.optimizeDeps.esbuildOptions.plugins`.
