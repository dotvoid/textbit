// More than one node: each document is held by one node at a time, by a
// lease in storage. A node a client reaches for a document it does not hold
// passes that document's frames on to the node that does, over a relay: a
// connection of its own to that node, speaking for the client.
//
// A relay says who it speaks for with the client's authentication, signed with
// the secret the nodes share, so only another node can.
import { createHmac, timingSafeEqual } from 'node:crypto'
import WebSocket from 'ws'
import { PROTOCOL_VERSION, ToClient, ToServer, decodeFrame, encodeFrame } from '@dotvoid/y-quorum-client/protocol'
import type { Authenticated } from './types'

const PREFIX = 'y-quorum-node '

/** A token one node gives another, speaking for a client */
export function nodeToken(secret: string, auth: Authenticated): string {
  const body = Buffer.from(JSON.stringify(auth)).toString('base64url')
  return `${PREFIX}${body}.${sign(secret, body)}`
}

/** Who a node speaks for, when the token is a node's; nothing otherwise */
export function readNodeToken(secret: string | undefined, token: string): Authenticated | undefined {
  if (!secret || !token.startsWith(PREFIX)) {
    return undefined
  }
  const [body, mac] = token.slice(PREFIX.length).split('.')
  if (!body || !mac) {
    return undefined
  }
  const expected = Buffer.from(sign(secret, body))
  const given = Buffer.from(mac)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return undefined
  }
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Authenticated
}

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url')
}

/** A connection to another node, speaking for one client */
export interface Relay {
  send(frame: Uint8Array): void
  close(): void
}

/**
 * Opens a relay to the node at `address`, for a client: resolves once that
 * node has welcomed it. Frames from it, but the welcome, go to `received`;
 * `closed` is called once when it ends, for whatever reason.
 */
export function openRelay(
  address: string,
  secret: string,
  auth: Authenticated,
  received: (frame: Uint8Array) => void,
  closed: () => void,
  timeout = 2000
): Promise<Relay> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(address)
    socket.binaryType = 'arraybuffer'
    let welcomed = false
    let ended = false
    const end = () => {
      if (!ended) {
        ended = true
        closed()
      }
    }
    const timer = setTimeout(() => {
      socket.terminate()
      reject(new Error(`y-quorum: no answer from the node at ${address}`))
    }, timeout)
    socket.on('open', () => {
      socket.send(encodeFrame(ToServer.HELLO, { protocol: PROTOCOL_VERSION, token: nodeToken(secret, auth) }))
    })
    socket.on('message', (data: ArrayBuffer) => {
      const bytes = new Uint8Array(data)
      if (welcomed) {
        received(bytes)
        return
      }
      const frame = decodeFrame(bytes)
      if (frame?.type === ToClient.WELCOME) {
        welcomed = true
        clearTimeout(timer)
        resolve({
          send: (out) => {
            if (socket.readyState === socket.OPEN) {
              socket.send(out)
            }
          },
          close: () => socket.close()
        })
      } else if (frame?.type === ToClient.REFUSED) {
        clearTimeout(timer)
        socket.close()
        reject(new Error(`y-quorum: the node at ${address} refused the relay`))
      }
    })
    socket.on('error', (error) => {
      if (!welcomed) {
        clearTimeout(timer)
        reject(error)
      }
    })
    socket.on('close', () => {
      clearTimeout(timer)
      if (welcomed) {
        end()
      }
    })
  })
}
