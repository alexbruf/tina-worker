import { createDatabase, createLocalDatabase } from '@tinacms/datalayer'
import { GitHubProvider } from 'tinacms-gitprovider-github'
import { D1Level } from '@alexbruf/d1-level'

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true'
const branch = process.env.GITHUB_BRANCH || 'main'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _d1: any = null
// Called once from src/index.ts (which can import cloudflare:workers; tina/ cannot).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function injectD1(d1: any) { _d1 = d1 }

// During `tinacms build`, _d1 is null and _open() would crash calling null.exec().
// Fall back to a no-op so the build-time open succeeds silently.
// TODO: fix d1-level _open to guard `if (!this.#d1) return callback(null)` like v2.x did.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const noopD1: any = { exec: () => Promise.resolve() }

// Lazy getter: resolved at request time, not module init.
// autoOpen defaults to false automatically when a getter is provided.
export const level = new D1Level({ d1: () => _d1 ?? noopD1, namespace: branch })

// Minimal GitHub HTTP bridge — used by database.indexContent() to read content from GitHub.
// Works in both Node.js (fetch available since v18) and Cloudflare Workers.
class GitHubHttpBridge {
  constructor(
    private owner: string,
    private repo: string,
    private branch: string,
    private token: string,
  ) {}

  async get(path: string): Promise<string> {
    const url = `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${this.branch}/${path}`
    const res = await fetch(url, { headers: { Authorization: `token ${this.token}` } })
    if (!res.ok) throw new Error(`GitHub GET ${path} → ${res.status}`)
    return res.text()
  }

  async glob(basePath: string, format: string): Promise<string[]> {
    const treeRes = await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/git/trees/${this.branch}?recursive=1`,
      { headers: { Authorization: `token ${this.token}`, 'User-Agent': 'tina-worker' } },
    )
    if (!treeRes.ok) throw new Error(`GitHub tree listing → ${treeRes.status}`)
    const { tree } = (await treeRes.json()) as { tree: Array<{ path: string; type: string }> }
    const ext = `.${format}`
    return tree
      .filter(item => item.type === 'blob' && item.path.startsWith(basePath) && item.path.endsWith(ext))
      .map(item => item.path)
  }

  // put is called by the db when writing changes back to git — delegated to GitHubProvider.onPut
  async put(_path: string, _content: string): Promise<void> { /* no-op: onPut handles writes */ }
}

export default isLocal
  ? createLocalDatabase()
  : createDatabase({
      gitProvider: new GitHubProvider({
        // With nodejs_compat + 2025-09-15, Worker vars/secrets are available as process.env.*
        repo: process.env.GITHUB_REPO!,
        owner: process.env.GITHUB_OWNER!,
        token: process.env.GITHUB_PERSONAL_ACCESS_TOKEN!,
        branch,
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bridge: new GitHubHttpBridge(
        process.env.GITHUB_OWNER!,
        process.env.GITHUB_REPO!,
        branch,
        process.env.GITHUB_PERSONAL_ACCESS_TOKEN!,
      ) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      databaseAdapter: level as any,
    })
