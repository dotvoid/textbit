// What the owner of a document puts right, and what it refuses.
//
// A person's write is never refused for its shape: refusing a CRDT update
// throws away their typing. Two people's valid changes at once can still merge
// into a shape neither made, which no single write shows: so the owner, and
// only the owner, repairs afterwards. Text fields by textbit's rules (the same
// ones an editor applies to its own changes), plain fields back to their last
// valid value, list items with a key an earlier one has removed.
//
// An agent's or code's write is checked first instead, on the shadow copy, and
// refused when it adds a problem: they can be told and try again.
import * as Y from '@y/y'
import * as delta from 'lib0/delta'
import {
  fieldToValue, repairField, validate, type TBPluginDefinition
} from '@dotvoid/textbit/headless'
import type { Principal } from '@dotvoid/y-quorum-client/protocol'
import {
  fieldIssues,
  projection,
  resolvePath,
  writeField,
  type Field,
  type FieldIssue,
  type ObjectField,
  type Path,
  type TextField,
  valueFits
} from '@dotvoid/y-quorum-client/model'

/** Who repairs, in the log and the history: the server, never a person */
export const REPAIRER: Principal = { kind: 'service', id: 'y-quorum', name: 'y-quorum' }

/** Plugins by the name a text field gives in `text({ plugins })` */
export type PluginSets = Record<string, TBPluginDefinition[]>

/** A text field's plugins: its set, else the default, else core's alone */
export function pluginsFor(
  field: TextField,
  plugins: PluginSets | undefined
): TBPluginDefinition[] {
  return plugins?.[field.plugins ?? 'default'] ?? plugins?.default ?? []
}

const keyOf = (path: Path) => path.join('\u0000')
const issueKey = (issue: FieldIssue) => `${issue.code}\u0000${keyOf(issue.path)}`

/** The text fields a write's paths end at, by path */
export function textFieldsAt(root: Y.Node, schema: ObjectField, paths: Path[]): Map<string, Path> {
  const found = new Map<string, Path>()
  for (const path of paths) {
    const resolved = resolvePath(root, schema, path)
    if (resolved?.field.kind === 'text' && resolved.value instanceof Y.Node) {
      found.set(keyOf(path), path)
    }
  }
  return found
}

/**
 * Why an agent's or code's write may not be stored: a problem in the content
 * after it that was not there before, outside the text or in a text field it
 * changed. Nothing when it adds none.
 */
export function checkWrite(
  before: Y.Node,
  after: Y.Node,
  schema: ObjectField,
  paths: Path[],
  plugins: PluginSets | undefined
): string | undefined {
  const had = new Set(fieldIssues(before, schema).map(issueKey))
  const added = fieldIssues(after, schema).find((issue) => !had.has(issueKey(issue)))
  if (added) {
    return added.message
  }
  for (const path of textFieldsAt(after, schema, paths).values()) {
    const field = resolvePath(after, schema, path)!.field as TextField
    const errors = (node: unknown) => node instanceof Y.Node
      ? validate(fieldToValue(node), pluginsFor(field, plugins))
        .filter((issue) => issue.severity === 'error')
      : []
    const known = new Set(errors(resolvePath(before, schema, path)?.value)
      .map((issue) => `${issue.code}\u0000${issue.id ?? ''}`))
    const fresh = errors(resolvePath(after, schema, path)!.value)
      .find((issue) => !known.has(`${issue.code}\u0000${issue.id ?? ''}`))
    if (fresh) {
      return `${path.join('.')}: ${fresh.message}`
    }
  }
  return undefined
}

/** What the owner has to repair, gathered from people's writes until it does */
export class Repairs {
  /** Text fields people changed */
  readonly text = new Map<string, Path>()
  /** Plain fields a person's write broke, with what they held before it */
  readonly previous = new Map<string, unknown>()
  /** Whether a write left list keys or fields to put right */
  plain = false

  get isEmpty(): boolean {
    return !this.text.size && !this.plain
  }

  /**
   * Notes what a person's write needs: the text fields it changed, and the
   * plain fields it broke, with the value each had before it
   */
  note(before: Y.Node, after: Y.Node, schema: ObjectField, paths: Path[]) {
    for (const [key, path] of textFieldsAt(after, schema, paths)) {
      this.text.set(key, path)
    }
    const had = new Set(fieldIssues(before, schema).map(issueKey))
    for (const issue of fieldIssues(after, schema)) {
      if (had.has(issueKey(issue))) {
        continue
      }
      this.plain = true
      const key = keyOf(issue.path)
      if (issue.code !== 'key' && !this.previous.has(key)) {
        const dotted = issue.path.join('.')
        this.previous.set(key, projection(before, schema, [dotted])[dotted])
      }
    }
  }

  /** Takes what was noted, leaving nothing */
  take(): { text: Path[], previous: Map<string, unknown> } {
    const taken = { text: [...this.text.values()], previous: new Map(this.previous) }
    this.text.clear()
    this.previous.clear()
    this.plain = false
    return taken
  }
}

/**
 * Repairs a document's content where it is, in a copy of the document: plain
 * fields and list keys first, then the text fields given
 */
export function repair(
  root: Y.Node,
  schema: ObjectField,
  work: { text: Path[], previous: Map<string, unknown> },
  plugins: PluginSets | undefined,
  origin: object
): void {
  const doc = root.doc!
  doc.transact(() => {
    for (const issue of fieldIssues(root, schema)) {
      if (issue.code === 'key') {
        // The later of two items with one key goes; so does one without a key
        const list = issue.item?.parent
        const index = list && issue.item ? indexIn(list, issue.item) : -1
        if (list && index >= 0) {
          list.applyDelta(delta.create().retain(index).delete(1).done())
        }
        continue
      }
      const parentPath = issue.path.slice(0, -1)
      const key = issue.path[issue.path.length - 1]
      const parent = parentPath.length
        ? resolvePath(root, schema, parentPath)
        : { value: root, field: schema }
      if (!(parent?.value instanceof Y.Node) || parent.field.kind !== 'object') {
        continue
      }
      const field: Field = parent.field.fields[key]
      const before = work.previous.get(keyOf(issue.path))
      writeField(parent.value, key, field, fits(field, before) ? before : emptyOf(field))
    }
  }, origin)
  for (const path of work.text) {
    const resolved = resolvePath(root, schema, path)
    if (resolved?.field.kind === 'text' && resolved.value instanceof Y.Node) {
      repairField(resolved.value, { plugins: pluginsFor(resolved.field, plugins), origin })
    }
  }
}

// Whether what a field held before a write can be written back: a value not
// given is, for a plain value, which is then removed
function fits(field: Field, value: unknown): boolean {
  if (field.kind === 'text' || field.kind === 'list') {
    return Array.isArray(value)
  }
  if (field.kind === 'object') {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }
  return valueFits(field, value)
}

// A field with nothing in it: an empty text field, object or list, a plain value not given
function emptyOf(field: Field): unknown {
  if (field.kind === 'text' || field.kind === 'list') {
    return []
  }
  return field.kind === 'object' ? {} : undefined
}

function indexIn(parent: Y.Node, child: Y.Node): number {
  for (let i = 0; i < parent.length; i++) {
    if (parent.get(i) === child) {
      return i
    }
  }
  return -1
}
