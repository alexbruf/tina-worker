import { reactRouter } from '@react-router/dev/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'
import path from 'node:path'

// readable-stream (used by abstract-level / TinaCMS) does require("process/")
// and require("string_decoder/") — npm polyfill packages that don't exist in
// Workers. Map them to shims that re-export from Node built-ins (nodejs_compat).
const nodePolyfillShims: Record<string, string> = {
  'process/': path.resolve(__dirname, 'src/shims/process.ts'),
  'string_decoder/': path.resolve(__dirname, 'src/shims/string_decoder.ts'),
}

// esbuild plugin to alias polyfill requires during SSR dep optimization
function esbuildNodePolyfillAlias(): import('esbuild').Plugin {
  return {
    name: 'node-polyfill-alias',
    setup(build) {
      build.onResolve({ filter: /^(process|string_decoder)\/$/ }, (args) => ({
        path: nodePolyfillShims[args.path],
      }))
    },
  }
}

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    reactRouter(),
  ],
  resolve: {
    alias: {
      // js-sha1 uses Node.js APIs not available in Workers — shim with node:crypto
      'js-sha1': path.resolve(__dirname, 'src/shims/js-sha1.ts'),
      // readable-stream polyfill aliases (see nodePolyfillShims above)
      ...nodePolyfillShims,
    },
  },
  ssr: {
    optimizeDeps: {
      esbuildOptions: {
        plugins: [esbuildNodePolyfillAlias()],
      },
    },
  },
})
