import { createHash } from 'node:crypto'

function sha1(message: string | ArrayBuffer | Uint8Array): string {
  const h = createHash('sha1')
  if (typeof message === 'string') {
    h.update(message, 'utf8')
  } else {
    h.update(new Uint8Array(message instanceof ArrayBuffer ? message : message.buffer))
  }
  return h.digest('hex')
}

sha1.hex = sha1
sha1.array = (message: string | ArrayBuffer | Uint8Array) =>
  Array.from(Buffer.from(sha1(message), 'hex'))
sha1.digest = sha1.array
sha1.arrayBuffer = (message: string | ArrayBuffer | Uint8Array) =>
  Buffer.from(sha1(message), 'hex').buffer
sha1.create = () => createHash('sha1')

export default sha1
