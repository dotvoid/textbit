// A raw protocol client for testing the server on its own
import WebSocket from 'ws'
import * as Y from '@y/y'
import {
  PROTOCOL_VERSION,
  ToClient,
  ToServer,
  decodeFrame,
  encodeFrame,
  type Frame,
  type FrameType,
  type Headers
} from '@dotvoid/y-quorum-client/protocol'

export class RawClient {
  frames: Frame[] = []
  closed?: { code: number, reason: string }
  private waiters: Array<{ match: (frame: Frame) => boolean, resolve: (frame: Frame) => void }> = []

  private constructor(readonly socket: WebSocket) {
    socket.binaryType = 'arraybuffer'
    socket.on('message', (data: ArrayBuffer) => {
      const frame = decodeFrame(new Uint8Array(data))
      if (!frame) {
        return
      }
      this.frames.push(frame)
      for (const waiter of [...this.waiters]) {
        if (waiter.match(frame)) {
          this.waiters.splice(this.waiters.indexOf(waiter), 1)
          waiter.resolve(frame)
        }
      }
    })
    socket.on('close', (code, reason) => {
      this.closed = { code, reason: reason.toString() }
    })
  }

  static async connect(port: number): Promise<RawClient> {
    const socket = new WebSocket(`ws://localhost:${port}`)
    await new Promise((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    return new RawClient(socket)
  }

  send<T extends keyof Headers>(type: T, header: Headers[T], payload?: Uint8Array) {
    this.socket.send(encodeFrame(type, header, payload))
  }

  /** The next frame of a type (and matching), waiting for it */
  next<T extends FrameType>(type: T, match: (header: Headers[T]) => boolean = () => true, timeout = 2000): Promise<Frame<T>> {
    const seen = this.frames.find((frame) => frame.type === type && match(frame.header as Headers[T]))
    if (seen) {
      this.frames.splice(this.frames.indexOf(seen), 1)
      return Promise.resolve(seen as Frame<T>)
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No frame ${type} within ${timeout} ms`)), timeout)
      this.waiters.push({
        match: (frame) => frame.type === type && match(frame.header as Headers[T]),
        resolve: (frame) => {
          clearTimeout(timer)
          this.frames.splice(this.frames.indexOf(frame), 1)
          resolve(frame as Frame<T>)
        }
      })
    })
  }

  async hello(token: string) {
    this.send(ToServer.HELLO, { protocol: PROTOCOL_VERSION, token })
    return this.next(ToClient.WELCOME)
  }

  /** Opens a document into a fresh Y.Doc and returns it, synced */
  async open(ref: number, namespace: string, id: string, doc = new Y.Doc()) {
    this.send(ToServer.OPEN, { ref, namespace, id, mode: 'open', clientId: doc.clientID }, Y.encodeStateVector(doc))
    const opened = await Promise.race([
      this.next(ToClient.OPENED, (h) => h.ref === ref),
      this.next(ToClient.CLOSED, (h) => h.ref === ref)
    ])
    if (opened.type === ToClient.OPENED) {
      Y.applyUpdate(doc, opened.payload, 'server')
    }
    return { doc, frame: opened }
  }

  /** Sends what a change made, as one UPDATE */
  change(ref: number, doc: Y.Doc, seq: number, change: () => void, claim?: Headers[typeof ToServer.UPDATE]['claim']) {
    const before = Y.encodeStateVector(doc)
    doc.transact(change)
    const update = Y.encodeStateAsUpdate(doc, before)
    this.send(ToServer.UPDATE, { ref, layer: 'content', seq, ...(claim ? { claim } : {}) }, update)
    return update
  }

  close() {
    this.socket.close()
  }
}
