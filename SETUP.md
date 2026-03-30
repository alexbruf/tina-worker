# tina-worker setup

Self-hosted TinaCMS backend on Cloudflare Workers (D1 + GitHub + Clerk auth).

---

## Prerequisites

- Cloudflare account with Workers + D1 access
- GitHub repo for your content
- Clerk account (free tier works)
- Wrangler CLI: `bun add -g wrangler`

---

## 1. Create the D1 database

```bash
wrangler d1 create tina-standalone-db
```

Copy the `database_id` into `wrangler.jsonc`.

---

## 2. Set secrets

Run each of these — Wrangler will prompt for the value:

```bash
wrangler secret put GITHUB_PERSONAL_ACCESS_TOKEN   # needs repo read+write
wrangler secret put CLERK_SECRET                   # from Clerk dashboard → API Keys
wrangler secret put GITHUB_WEBHOOK_SECRET          # any random string, e.g: openssl rand -hex 32
```

The non-secret vars (`GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`, `TINA_PUBLIC_CLERK_PUBLIC_KEY`) are already in `wrangler.jsonc` — edit them to match your project.

---

## 3. Build and deploy

```bash
bun run deploy        # runs tinacms build then wrangler deploy
```

Your worker will be live at `https://tina-worker.<subdomain>.workers.dev`.

---

## 4. Set up the GitHub webhook (instant reindex on push)

Without this, content pushed directly to GitHub (outside the CMS) won't appear in TinaCMS for up to 6 hours (the cron fallback). The webhook makes it instant.

**In your GitHub content repo → Settings → Webhooks → Add webhook:**

| Field | Value |
|---|---|
| Payload URL | `https://tina-worker.<subdomain>.workers.dev/tina/webhook` |
| Content type | `application/json` |
| Secret | the value you used for `GITHUB_WEBHOOK_SECRET` |
| Events | Just the push event |
| Active | ✅ |

Click **Add webhook**. GitHub will send a ping — the worker returns 401 for pings (no `x-hub-signature-256`), which is fine; GitHub shows it as delivered.

From then on, every push to `main` triggers an immediate reindex. The 6-hour cron in `wrangler.jsonc` stays as a safety net.

---

## 5. Install the pre-commit hook

The hook rejects images over 800KB committed to `public/uploads/`.

```bash
bun run install-hooks
```

Run this once after cloning. Team members need to run it too.

**If an image is rejected:**
```bash
# Resize to max 2000px on the longest side (macOS built-in):
sips -Z 2000 public/uploads/photo.jpg

# Or with ImageMagick:
brew install imagemagick
convert public/uploads/photo.jpg -quality 80 public/uploads/photo.jpg
```

> Note: Images uploaded via the TinaCMS UI bypass this hook (they go directly to GitHub via API). Rely on communicating the size guideline to CMS users, or add server-side validation later.

---

## 6. Image optimization in your frontend

Images in `public/uploads/` are served at `/uploads/photo.jpg` (raw) and through the transform route at `/img`:

```
/img?src=uploads/photo.jpg&w=800              → 800px wide, WebP
/img?src=uploads/photo.jpg&w=400&h=400&fit=cover → 400×400 crop, WebP
/img?src=uploads/photo.jpg&format=avif&q=90   → AVIF, quality 90
```

**React Router:**
```jsx
<img src="/img?src=uploads/hero.jpg&w=1200" alt="Hero" />
```

**Astro:**
```astro
<img src="/img?src=uploads/hero.jpg&w=1200" alt="Hero" />
```

Locally (`wrangler dev`), `/img` redirects to the raw asset — images still show, just unoptimized.

**Cloudflare requirement:** Image transformation requires a **Pro plan or above** and must be enabled at: Cloudflare dashboard → your zone → Speed → Optimization → Image Resizing → On. On a free plan or `*.workers.dev` without a custom zone, the `/img` route falls back to the raw image.

---

## 7. Local development

```bash
bun run dev          # wrangler dev (D1 emulated by miniflare)
```

TinaCMS admin at: `http://localhost:8787/admin/index.html`

For local TinaCMS dev with hot-reload:
```bash
bun run tina:dev     # tinacms dev -c "wrangler dev"
```

---

## Cron

`wrangler.jsonc` includes a cron at `0 */6 * * *` (every 6 hours) that reindexes content from GitHub. This catches pushes that arrive while the webhook is down or misconfigured. No action needed — it runs automatically after deploy.
