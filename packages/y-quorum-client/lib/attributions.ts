// Who wrote what, the way Y.js 14 keeps it: a ContentMap beside the document,
// mapping the ids of inserted and deleted content to attributes. The server
// builds it from the writes it accepts, stamped with the actor it decided on,
// so nobody can claim someone else's text; clients render it.
//
// The attributes follow Y.js's renderers: `insert` and `delete` name who,
// `insertAt` and `deleteAt` say when, and `insert:onBehalfOf`, `insert:run`
// (and their `delete:` twins) pass through as they are.
import * as Y from '@y/y'
import type { Person } from './protocol'

/** The key attributions name someone by: their kind and id, so a person and an agent never collide */
export function actorKey(who: { kind: string, id: string }): string {
  return `${who.kind}:${who.id}`
}

/** Who made a change, and when */
export interface Attributed {
  by: Person
  /** The person an agent or service acted for */
  onBehalfOf?: Person
  /** The agent's run */
  run?: string
  /** Milliseconds */
  at: number
}

/** The attributions of one change: what it inserted and deleted, by whom and when */
export function attributionsOf(inserts: Y.IdSet, deletes: Y.IdSet, change: Attributed): Y.ContentMap {
  const attributes = (verb: 'insert' | 'delete') => [
    Y.createContentAttribute(verb, actorKey(change.by)),
    Y.createContentAttribute(`${verb}At`, change.at),
    ...(change.onBehalfOf ? [Y.createContentAttribute(`${verb}:onBehalfOf`, actorKey(change.onBehalfOf))] : []),
    ...(change.run ? [Y.createContentAttribute(`${verb}:run`, change.run)] : [])
  ]
  return Y.createContentMapFromContentIds(Y.createContentIds(inserts, deletes), attributes('insert'), attributes('delete'))
}

/** No attributions */
export function emptyAttributions(): Y.ContentMap {
  return Y.createContentMap()
}

/**
 * A renderer showing who wrote what, kept current: `add` takes the
 * attributions of further changes and tells the editors bound through it.
 * Shows the text as it is, each piece with who wrote it; `withDeleted` shows
 * deleted text too, with who deleted it.
 */
export class LiveAttributionsRenderer extends Y.AttributionsRenderer {
  private readonly withDeleted: boolean
  private all: Y.ContentMap

  constructor(attributions: Y.ContentMap, { withDeleted = false }: { withDeleted?: boolean } = {}) {
    super(shown(attributions, withDeleted))
    this.withDeleted = withDeleted
    this.all = attributions
  }

  /** Adds the attributions of a change, and re-renders what they cover */
  add(attributions: Y.ContentMap): void {
    this.all = Y.mergeContentMaps([this.all, attributions])
    // Y.js renders whatever the map covers, deleted or not: text deleted
    // since must leave it, so it is worked out again
    const view = shown(this.all, this.withDeleted)
    this.renderAs = Y.mergeIdMaps([view.inserts, view.deletes])
    this.attributed = Y.createIdSetFromIdMap(this.renderAs)
    const covered = Y.mergeIdSets([
      Y.createIdSetFromIdMap(attributions.inserts),
      Y.createIdSetFromIdMap(attributions.deletes)
    ])
    this.emit('change', [covered, null, false])
  }
}

// What a view of the attributions renders: the text as it is, or with what
// was deleted too
function shown(attributions: Y.ContentMap, withDeleted: boolean): Y.ContentMap {
  return withDeleted
    ? attributions
    : Y.createContentMap(Y.diffIdMap(attributions.inserts, attributions.deletes), Y.createIdMap())
}
