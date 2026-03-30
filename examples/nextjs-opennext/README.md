# TinaCMS + Next.js on Cloudflare Workers (via OpenNext)

Self-hosted TinaCMS with Next.js, deployed to Cloudflare Workers via @opennextjs/cloudflare.
Backed by D1 + GitHub + Clerk auth.

## Architecture

```
Next.js (Pages Router, deployed via OpenNext)
  pages/index.tsx                  - Your site pages
  pages/api/tina/[...routes].ts   - Catch-all API route for TinaCMS backend
  public/admin/index.html         - Generated TinaCMS admin UI (static)

tina/config.ts     - Schema, auth provider (Clerk), admin UI config
tina/database.ts   - Database adapter (D1Level for prod, local filesystem for dev)
tina/__generated__ - Auto-generated client, types, schema (from `tinacms build`)

Cloudflare bindings:
  DB (D1)          - Content index storage
  Vars             - GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, etc.
  Secrets          - CLERK_SECRET, GITHUB_PERSONAL_ACCESS_TOKEN
```

In local mode (`TINA_PUBLIC_IS_LOCAL=true`), TinaCMS uses the local filesystem instead of D1/GitHub, and skips Clerk auth. No external services needed.

## Prerequisites

- [Bun](https://bun.sh/) (or Node 18+)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (for deploy)

## Quick start (local mode)

```bash
bunx degit alexbruf/tina-worker/examples/nextjs-opennext my-tina-nextjs
cd my-tina-nextjs
bun install
cp .env.example .env   # defaults to TINA_PUBLIC_IS_LOCAL=true
bun run dev
```

Open http://localhost:3000/admin/index.html to edit content.

## Patches

Three patches are applied via `patchedDependencies` in `package.json`:

- **`@tinacms/graphql@2.2.1`** - Fixes a LevelDB proxy handler that throws on non-function property access (e.g. `parent`, `prefix`, `status`). Required for `d1-level` compatibility.
- **`@tinacms/mdx@1.8.3` / `@2.1.0`** - Adds `workerd` and `worker` export conditions so the correct module entry point is resolved in Cloudflare Workers.

## Deploy to Cloudflare

1. Create a D1 database:
   ```bash
   wrangler d1 create tina-db
   ```
2. Update `wrangler.jsonc` with the returned `database_id`
3. Update vars in `wrangler.jsonc`:
   - `GITHUB_OWNER` - Your GitHub username
   - `GITHUB_REPO` - The repo containing your content
   - `GITHUB_BRANCH` - Branch to read/write content (default: `main`)
   - `TINA_PUBLIC_IS_LOCAL` - Set to `"false"` for production
   - `TINA_PUBLIC_CLERK_PUBLIC_KEY` - Your Clerk publishable key
4. Set secrets:
   ```bash
   wrangler secret put CLERK_SECRET
   wrangler secret put GITHUB_PERSONAL_ACCESS_TOKEN
   ```
5. Deploy:
   ```bash
   bun run deploy
   ```
