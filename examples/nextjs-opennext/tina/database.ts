// tina/database.ts — Next.js via @opennextjs/cloudflare
//
// In local mode (TINA_PUBLIC_IS_LOCAL=true), uses the filesystem — no D1 or GitHub needed.
// In production, D1 is injected per-request via injectD1() called from the API route handler
// (pages/api/tina/[...routes].ts), which resolves env.DB via getCloudflareContext().

import { createDatabase, createLocalDatabase } from '@tinacms/datalayer'
import { GitHubProvider } from 'tinacms-gitprovider-github'
import { D1Level } from '@alexbruf/d1-level'

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true'
const branch = process.env.GITHUB_BRANCH || 'main'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _d1: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function injectD1(d1: any) { _d1 = d1 }

export default isLocal
  ? createLocalDatabase()
  : createDatabase({
      gitProvider: new GitHubProvider({
        repo: process.env.GITHUB_REPO!,
        owner: process.env.GITHUB_OWNER!,
        token: process.env.GITHUB_PERSONAL_ACCESS_TOKEN!,
        branch,
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      databaseAdapter: new D1Level({ d1: () => _d1, namespace: branch }) as any,
    })
