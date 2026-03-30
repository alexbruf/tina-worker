// Shim for the "string_decoder/" npm polyfill package.
// readable-stream does require("string_decoder/") which doesn't exist in Workers.
// Re-export from the built-in node:string_decoder (available via nodejs_compat).
export { StringDecoder } from 'node:string_decoder'
