# tina-worker

Self-hosted [TinaCMS](https://tina.io) backend on Cloudflare Workers, backed by D1 (SQLite), GitHub, and Clerk auth.

**No Tina Cloud account needed.** Your content lives in your GitHub repo, indexed in a D1 database, with Clerk handling authentication. Everything runs on Cloudflare's free tier.

## What's in this repo

```
tina-worker/
  src/index.ts          Standalone Worker (Express + httpServerHandler)
  tina/                 TinaCMS schema, database adapter, generated files
  wrangler.jsonc        Cloudflare Workers config
  SETUP.md              Detailed setup & deploy guide

  examples/
    astro/              Astro + TinaCMS starter
    nextjs-opennext/    Next.js + TinaCMS starter (via OpenNext)
    react-router-v7/    React Router v7 + TinaCMS starter
```

## Quick start (framework starters)

Pick your framework and scaffold a project:

```bash
# Astro
bunx degit alexbruf/tina-worker/examples/astro my-tina-site

# Next.js (via OpenNext)
bunx degit alexbruf/tina-worker/examples/nextjs-opennext my-tina-site

# React Router v7
bunx degit alexbruf/tina-worker/examples/react-router-v7 my-tina-site
```

Then:

```bash
cd my-tina-site
bun install
cp .env.example .env   # defaults to local mode
bun run dev
```

Open `/admin/index.html` to edit content. See each example's README for deploy instructions.

## Quick start (standalone Worker)

Use the standalone worker when you want TinaCMS as a separate backend service, decoupled from your frontend.

```bash
git clone https://github.com/alexbruf/tina-worker.git
cd tina-worker
bun install
```

Create `.dev.vars` with your secrets:

```
CLERK_SECRET=sk_test_...
GITHUB_PERSONAL_ACCESS_TOKEN=ghp_...
```

Edit `wrangler.jsonc` with your GitHub repo and Clerk publishable key, then:

```bash
bun run dev
```

Admin UI at `http://localhost:8787/admin/index.html`. See [SETUP.md](SETUP.md) for full deploy instructions.

## Architecture

```
Browser (TinaCMS Admin UI)
  |
  POST /api/tina/gql (or /tina/gql for standalone)
  |
  Cloudflare Worker
    ├── Clerk JWT verification
    ├── TinaNodeBackend (GraphQL resolver)
    │     ├── D1 database (content index via @alexbruf/d1-level)
    │     └── GitHub API (content read/write via tinacms-gitprovider-github)
    └── Cron trigger (reindex every 6h)
```

- **D1** stores the content index (key-value pairs via [d1-level](https://github.com/alexbruf/d1-level), an `abstract-level` adapter for D1)
- **GitHub** is the source of truth for content files (Markdown, JSON, etc.)
- **Clerk** handles user authentication (free tier, no vendor lock-in on the data layer)
- **Cron** reindexes content from GitHub every 6 hours as a safety net; a GitHub webhook endpoint (`/tina/webhook`) enables instant reindexing on push

## Cloudflare Workers compatibility

TinaCMS was built for Node.js/Vercel. Running it on Workers requires:

- `nodejs_compat` flag + `compatibility_date: "2025-09-15"`
- `js-sha1` aliased to a `node:crypto` shim (avoids `eval("require('crypto')")` in the UMD wrapper)
- Three patches via `patchedDependencies`:
  - `@tinacms/graphql@2.2.1` — fixes LevelDB proxy handler for d1-level compatibility
  - `@tinacms/mdx@1.8.3` / `@2.1.0` — adds `workerd` export conditions

The React Router v7 example additionally needs `process/` and `string_decoder/` shims, a Web Streams entry server, and a Node-to-Web handler adapter. See its [README](examples/react-router-v7/README.md) for details.

## License

MIT
