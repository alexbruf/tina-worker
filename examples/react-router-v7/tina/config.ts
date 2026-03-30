// tina/config.ts — React Router v7 on Cloudflare Workers
//
// Copy to your project's tina/config.ts and replace the schema with your content types.
// Key difference from standalone worker: contentApiUrlOverride uses /api/tina/gql
// because TinaCMS is embedded as a framework route (not a top-level worker).

import { defineConfig } from 'tinacms'

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true'

// Clerk auth is only needed for production (non-local) mode.
// @clerk/clerk-js is a browser SDK that can't be imported during `tinacms build`
// (which runs in Node.js), so we guard the import behind a runtime check.
let authProvider: object | undefined
if (!isLocal && typeof window !== 'undefined') {
  // Dynamic import would be ideal but defineConfig needs it synchronously,
  // so we rely on the build step always running with TINA_PUBLIC_IS_LOCAL=true.
  // At runtime in the browser, this block initializes Clerk for the admin UI.
  const { ClerkAuthProvider } = require('tinacms-clerk/dist/tinacms')
  const Clerk = require('@clerk/clerk-js').default
  const clerk = new Clerk(process.env.TINA_PUBLIC_CLERK_PUBLIC_KEY || '')
  authProvider = new ClerkAuthProvider({ clerk })
}

export default defineConfig({
  branch: process.env.GITHUB_BRANCH || 'main',

  ...(authProvider ? { authProvider } : {}),

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
