// Accepting a suggestion, or recording that it was rejected, writes the
// suggester's own items into the content. The server lets those items through
// under the suggester's client id only when they are the very items of the
// fork: the same place and the same content, unit by unit (a character, a
// value, a node). A rejection may write them already deleted. Anything else
// under a fork item's id is new content dressed up as a suggestion.
import * as Y from '@y/y'

/** One unit of an item: where it sits and what it holds */
interface Unit {
  origin: string | null
  right: string | null
  /** Only where the place is not implied by a neighbour: the parent and key */
  parent: string | null
  key: string | null
  value: string
  deleted: boolean
}

type StructLike = {
  id: { client: number, clock: number }
  length: number
  origin?: { client: number, clock: number } | null
  rightOrigin?: { client: number, clock: number } | null
  parent?: { client: number, clock: number } | string | null
  parentSub?: string | null
  content?: Record<string, unknown>
}

const idOf = (id: { client: number, clock: number } | null | undefined) => (id ? `${id.client}:${id.clock}` : null)

/** The units of an update's items that fall within a set of ids */
function unitsOf(update: Uint8Array, within: Y.IdSet): Map<string, Unit> {
  const units = new Map<string, Unit>()
  for (const struct of Y.decodeUpdate(update).structs as unknown as StructLike[]) {
    if (!struct.content) {
      continue // GC and Skip: no content, no place
    }
    for (let k = 0; k < struct.length; k++) {
      const id = { client: struct.id.client, clock: struct.id.clock + k }
      if (!within.hasId(id)) {
        continue
      }
      const origin = k === 0 ? idOf(struct.origin) : `${id.client}:${id.clock - 1}`
      const right = idOf(struct.rightOrigin)
      // With a neighbour, Y.js takes the parent and key from it and does not
      // encode them: compare them only where nothing implies them
      const placedBy = origin === null && right === null
      const parent = placedBy
        ? (typeof struct.parent === 'string' ? `root:${struct.parent}` : idOf(struct.parent ?? null))
        : null
      units.set(`${id.client}:${id.clock}`, {
        origin,
        right,
        parent,
        key: placedBy ? struct.parentSub ?? null : null,
        ...valueOf(struct.content, k)
      })
    }
  }
  return units
}

function valueOf(content: Record<string, unknown>, k: number): { value: string, deleted: boolean } {
  if (typeof content.str === 'string') {
    return { value: `s:${content.str[k]}`, deleted: false }
  }
  if (Array.isArray(content.arr)) {
    return { value: `a:${JSON.stringify(content.arr[k])}`, deleted: false }
  }
  if (typeof content.key === 'string' && 'value' in content) {
    return { value: `f:${content.key}=${JSON.stringify(content.value)}`, deleted: false }
  }
  if (content.type && typeof content.type === 'object') {
    return { value: `t:${String((content.type as { name?: unknown }).name ?? '')}`, deleted: false }
  }
  if ('embed' in content) {
    return { value: `e:${JSON.stringify(content.embed)}`, deleted: false }
  }
  if (typeof content.len === 'number') {
    return { value: '', deleted: true }
  }
  return { value: `?:${Object.keys(content).join(',')}`, deleted: false }
}

/**
 * Whether the items an update writes under fork ids are the fork's own: the
 * reason they are not, or nothing. `rejecting` allows them to be written
 * deleted.
 */
export function differsFromFork(update: Uint8Array, fork: Y.Doc, ids: Y.IdSet): string | undefined {
  const written = unitsOf(update, ids)
  const suggested = unitsOf(Y.encodeStateAsUpdate(fork), ids)
  for (const [id, unit] of written) {
    const original = suggested.get(id)
    if (!original) {
      return `${id} is not in the suggestions`
    }
    const samePlace = unit.origin === original.origin && unit.right === original.right &&
      unit.parent === original.parent && unit.key === original.key
    if (!samePlace) {
      return `${id} is not where it was suggested`
    }
    if (!unit.deleted && (original.deleted || unit.value !== original.value)) {
      return `${id} is not what was suggested`
    }
  }
  return undefined
}
