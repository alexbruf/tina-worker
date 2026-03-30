// tina/config.ts — Next.js (OpenNext) on Cloudflare Workers
//
// Copy to your project's tina/config.ts and replace the schema with your content types.
// Key difference from standalone worker: contentApiUrlOverride uses /api/tina/gql
// because TinaCMS is embedded as a framework route (not a top-level worker).

import { defineConfig } from 'tinacms'

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true'

// Only initialize Clerk when not in local mode — Clerk's constructor
// throws if given an empty publishable key.
let authProvider: object | undefined
if (!isLocal) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ClerkAuthProvider } = require('tinacms-clerk/dist/tinacms')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Clerk = require('@clerk/clerk-js').default
  const clerk = new Clerk(process.env.TINA_PUBLIC_CLERK_PUBLIC_KEY || '')
  authProvider = new ClerkAuthProvider({ clerk })
}

export default defineConfig({
  branch: process.env.GITHUB_BRANCH || 'main',

  authProvider: isLocal ? undefined : authProvider,

  // Points the TinaCMS admin UI at your framework's API route
  contentApiUrlOverride: '/api/tina/gql',

  build: {
    outputFolder: 'admin',
    publicFolder: 'public',
  },
  media: {
    tina: {
      mediaRoot: 'uploads',
      publicFolder: 'public',
    },
  },

  schema: {
    collections: [
      {
        name: 'post',
        label: 'Posts',
        path: 'content/posts',
        fields: [
          { type: 'string', name: 'title', label: 'Title', isTitle: true, required: true },
          { type: 'datetime', name: 'date', label: 'Published Date' },
          { type: 'rich-text', name: 'body', label: 'Body', isBody: true },
        ],
      },
    ],
  },
})
