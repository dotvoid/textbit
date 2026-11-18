import { Element, Node, type Descendant, type Path } from 'slate'

/**
 * How an agent refers to an element: the start of its id, six characters or
 * more, enough to tell it from every other id in the document. It needs no
 * state, so it stays the same from one request to the next, and any unique
 * start of an id, or the whole id, is understood.
 *
 * An element without an id, which text elements may be, is referred to by its
 * path, as `@2.1`. That changes when blocks before it move.
 */
export const HANDLE_LENGTH = 6

export interface Handles {
  /** The handle of an element */
  of(element: Element, path: Path): string
  /** The element a handle refers to */
  resolve(handle: string): HandleMatch
}

export type HandleMatch =
  | { found: true, id?: string, path: Path, element: Element }
  | { found: false, reason: 'not-found' | 'ambiguous', candidates?: string[] }

export function createHandles(document: Descendant[]): Handles {
  const entries: { id: string, path: Path, element: Element }[] = []
  for (const [node, path] of Node.nodes({ children: document } as Node)) {
    if (path.length && Element.isElement(node) && typeof node.id === 'string') {
      entries.push({ id: node.id, path, element: node })
    }
  }
  const ids = entries.map((entry) => entry.id)

  return {
    of: (element, path) => typeof element.id === 'string'
      ? shortest(element.id, ids)
      : `@${path.join('.')}`,

    resolve: (raw) => {
      const handle = raw.trim().replace(/^#/, '')
      if (handle.startsWith('@')) {
        return byPath(document, handle.slice(1))
      }

      const exact = entries.find((entry) => entry.id === handle)
      if (exact) {
        return { found: true, ...exact }
      }
      const matches = handle.length >= 4 ? entries.filter((entry) => entry.id.startsWith(handle)) : []
      if (matches.length === 1) {
        return { found: true, ...matches[0] }
      }
      return matches.length
        ? { found: false, reason: 'ambiguous', candidates: matches.map((m) => shortest(m.id, ids)) }
        : { found: false, reason: 'not-found' }
    }
  }
}

/** The shortest start of an id, of at least HANDLE_LENGTH, no other id begins with */
function shortest(id: string, ids: string[]): string {
  for (let length = Math.min(HANDLE_LENGTH, id.length); length < id.length; length++) {
    const start = id.slice(0, length)
    if (!ids.some((other) => other !== id && other.startsWith(start))) {
      return start
    }
  }
  return id
}

function byPath(document: Descendant[], raw: string): HandleMatch {
  const path = raw.split('.').map(Number)
  if (!path.length || path.some((index) => !Number.isInteger(index) || index < 0)) {
    return { found: false, reason: 'not-found' }
  }
  try {
    const node = Node.get({ children: document } as Node, path)
    return Element.isElement(node)
      ? { found: true, ...(typeof node.id === 'string' ? { id: node.id } : {}), path, element: node }
      : { found: false, reason: 'not-found' }
  } catch {
    return { found: false, reason: 'not-found' }
  }
}
