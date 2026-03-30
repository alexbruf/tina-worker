import { defineConfig } from 'tinacms'
import { ClerkAuthProvider } from 'tinacms-clerk/dist/tinacms'
import Clerk from '@clerk/clerk-js'

const clerk = new Clerk(process.env.TINA_PUBLIC_CLERK_PUBLIC_KEY || '')

export default defineConfig({
  branch: process.env.GITHUB_BRANCH || 'main',

  // Clerk handles frontend auth — signs in the user and provides a session token
  // for GQL requests. clerk.load() is called lazily inside ClerkAuthProvider.
  authProvider: new ClerkAuthProvider({ clerk }),

  // Self-hosted: point the frontend at the Worker's GQL endpoint.
  // During local dev (tinacms dev), leave this as /tina/gql.
  // The standalone backend runs at: https://tina-worker.<subdomain>.workers.dev
  contentApiUrlOverride: '/tina/gql',

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
          {
            type: 'string',
            name: 'title',
            label: 'Title',
            isTitle: true,
            required: true,
          },
          {
            type: 'datetime',
            name: 'date',
            label: 'Published Date',
          },
          {
            type: 'rich-text',
            name: 'body',
            label: 'Body',
            isBody: true,
          },
        ],
      },
    ],
  },
})
