// tina/database.ts — React Router v7 on Cloudflare Workers
//
// D1 is injected per-request via injectD1() called from the route handler
// (app/routes/api.tina.$.tsx), which has access to context.cloudflare.env.DB.
// The lazy getter means module-level initialisation never touches D1.

import { createDatabase, createLocalDatabase } from '@tinacms/datalayer'
import { GitHubProvider } from 'tinacms-gitprovider-github'
import { D1Level } from '@alexbruf/d1-level'

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true'
const branch = process.env.GITHUB_BRANCH || 'main'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _d1: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function injectD1(d1: any) { _d1 = d1 }

// Only construct D1Level when not in local mode — during `tinacms build` (which
// runs with TINA_PUBLIC_IS_LOCAL=true), the D1 binding doesn't exist and the
// level instance would fail when the build process tries to open it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const level: any = isLocal ? null : new D1Level({ d1: () => _d1, namespace: branch })

export default isLocal
  ? createLocalDatabase()
  : createDatabase({
      gitProvider: new GitHubProvider({
        repo: process.env.GITHUB_REPO!,
        owner: process.env.GITHUB_OWNER!,
        token: process.env.GITHUB_PERSONAL_ACCESS_TOKEN!,
        branch,
      }),
      databaseAdapter: level,
    })
