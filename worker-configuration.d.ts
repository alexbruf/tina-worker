// Type declarations for Cloudflare Worker bindings.
// Regenerate automatically with: wrangler types
//
// The Cloudflare.Env interface is the correct extension point — it merges with
// @cloudflare/workers-types and types `env` from `import { env } from 'cloudflare:workers'`.

declare namespace Cloudflare {
  interface Env {
    // D1 database binding
    DB: D1Database

    // GitHub vars (set in wrangler.jsonc [vars])
    GITHUB_OWNER: string
    GITHUB_REPO: string
    GITHUB_BRANCH: string
    TINA_PUBLIC_IS_LOCAL: string

    // Clerk (set CLERK_SECRET via: wrangler secret put CLERK_SECRET)
    TINA_PUBLIC_CLERK_PUBLIC_KEY: string
    CLERK_SECRET: string

    // Secrets (set via: wrangler secret put <NAME>)
    GITHUB_PERSONAL_ACCESS_TOKEN: string
    GITHUB_WEBHOOK_SECRET: string
  }
}
