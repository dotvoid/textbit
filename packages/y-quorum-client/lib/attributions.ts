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

/** Text agents wrote that is still there and no person has reviewed since, by agent, person and run */
export interface Unreviewed {
  /** The agent's key, e.g. `agent:copy` */
  agent: string
  /** The person it wrote for */
  onBehalfOf?: string
  run?: string
  /** How much of it there is: characters, and one for each element */
  length: number
}

/** The content agents inserted, all of it or one run's: what a person reviews */
export function agentContent(attributions: Y.ContentMap, scope: { run?: string } = {}): Y.IdSet {
  const value = (attrs: Array<Y.ContentAttribute<unknown>>, name: string) => attrs.find((attr) => attr.name === name)?.val
  return Y.createIdSetFromIdMap(Y.filterIdMap(attributions.inserts, (attrs) =>
    String(value(attrs, 'insert') ?? '').startsWith('agent:') &&
    (scope.run === undefined || value(attrs, 'insert:run') === scope.run)))
}

/** What agents wrote that is still in the text and outside `reviewed`, oldest first */
export function unreviewed(attributions: Y.ContentMap, reviewed: Y.IdSet): Unreviewed[] {
  const open = Y.diffIdMap(Y.diffIdMap(attributions.inserts, attributions.deletes), reviewed)
  const groups = new Map<string, Unreviewed>()
  const first = new Map<string, number>()
  open.forEach((range) => {
    const value = (name: string) => range.attrs.find((attr) => attr.name === name)?.val
    const agent = String(value('insert') ?? '')
    if (!agent.startsWith('agent:')) {
      return
    }
    const onBehalfOf = value('insert:onBehalfOf')
    const run = value('insert:run')
    const key = JSON.stringify([agent, onBehalfOf ?? null, run ?? null])
    const group = groups.get(key) ?? {
      agent,
      ...(typeof onBehalfOf === 'string' ? { onBehalfOf } : {}),
      ...(typeof run === 'string' ? { run } : {}),
      length: 0
    }
    group.length += range.len
    groups.set(key, group)
    const at = Number(value('insertAt') ?? 0)
    first.set(key, Math.min(first.get(key) ?? at, at))
  })
  return [...groups.entries()].sort(([a], [b]) => first.get(a)! - first.get(b)!).map(([, group]) => group)
}

/** Which changes to take back: by run, by who made them, from a moment on; all must hold */
export interface ChangesOf {
  run?: string
  /** The actor's key, e.g. `agent:copy` */
  by?: string
  /** Milliseconds: changes made at or after it */
  since?: number
}

/** The content a run, an actor, or a stretch of time inserted and deleted */
export function contentOf(attributions: Y.ContentMap, which: ChangesOf): Y.ContentIds {
  const matches = (verb: 'insert' | 'delete') => (attrs: Array<Y.ContentAttribute<unknown>>) => {
    const value = (name: string) => attrs.find((attr) => attr.name === name)?.val
    return (which.run === undefined || value(`${verb}:run`) === which.run) &&
      (which.by === undefined || value(verb) === which.by) &&
      (which.since === undefined || Number(value(`${verb}At`) ?? 0) >= which.since)
  }
  return Y.createContentIds(
    Y.createIdSetFromIdMap(Y.filterIdMap(attributions.inserts, matches('insert'))),
    Y.createIdSetFromIdMap(Y.filterIdMap(attributions.deletes, matches('delete')))
  )
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
  /** Called once when destroyed, so whoever keeps it current lets it go */
  onDestroy: (() => void) | undefined

  constructor(attributions: Y.ContentMap, { withDeleted = false }: { withDeleted?: boolean } = {}) {
    super(shown(attributions, withDeleted))
    this.withDeleted = withDeleted
    this.all = attributions
  }

  override destroy(): void {
    super.destroy()
    const done = this.onDestroy
    this.onDestroy = undefined
    done?.()
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
