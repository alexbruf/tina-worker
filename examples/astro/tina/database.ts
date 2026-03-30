// tina/database.ts — Astro on Cloudflare Workers
//
// D1 is injected per-request via injectD1() called from the API route
// (src/pages/api/tina/[...routes].ts), which has access to locals.runtime.env.DB.

import { createDatabase, createLocalDatabase } from '@tinacms/datalayer'
import { GitHubProvider } from 'tinacms-gitprovider-github'
import { D1Level } from '@alexbruf/d1-level'

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true'
const branch = process.env.GITHUB_BRANCH || 'main'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _d1: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function injectD1(d1: any) { _d1 = d1 }

// Only instantiate D1Level when not in local mode — tinacms build evaluates this
// module and D1Level._open() would fail without a real D1 binding.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let level: any = null
if (!isLocal) {
  level = new D1Level({ d1: () => _d1, namespace: branch })
}

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
      databaseAdapter: level as any,
    })
