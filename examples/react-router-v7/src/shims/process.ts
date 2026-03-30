// Shim for the "process/" npm polyfill package.
// readable-stream (used by abstract-level / TinaCMS) does require("process/")
// which doesn't exist in the Workers runtime. Alias this to re-export the
// built-in process global (available via nodejs_compat).
export default process
export const {
  nextTick,
  env,
  argv,
  cwd,
  pid,
  platform,
  version,
  versions,
  emit,
  on,
  off,
  addListener,
  removeListener,
  stdout,
  stderr,
} = process
