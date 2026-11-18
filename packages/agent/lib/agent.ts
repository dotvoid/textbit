import { Editor, Element, Node, Text, type Path } from 'slate'
import { createContext, type AgentContext, type AgentOptions } from './context'
import { formatElements } from './format'
import { describeSchema } from './describe'
import { planEdit, runEdit, isStepError, pathOf, type EditOperation, type EditResult } from './edit'
import { changedSince, recordRevision, revisionOf } from './revisions'

export interface ReadInput {
  /** Start at this top-level element, by handle. Default: the first. */
  from?: string
  /** Top-level elements to return at most */
  limit?: number
}

export interface ReadResult {
  revision: string
  /** The elements, in the document's line format */
  view: string
  /** Top-level elements in the document */
  total: number
  /** Where the next page starts, when there is more */
  next?: string
}

export interface SearchInput {
  /** Text to look for, case ignored */
  query: string
  /** Matches to return at most. Default: 20. */
  limit?: number
}

export interface SearchResult {
  revision: string
  /** Each text element containing the query, as its line, with the top-level element it is in */
  matches: { line: string, in?: string }[]
}

export interface EditInput {
  operations: EditOperation[]
  /** The revision the changes were planned against, from read or search */
  revision?: string
  /** An id for this batch: sent again, it is not applied again */
  opId?: string
}

export interface DocumentAgent {
  read(input?: ReadInput): ReadResult
  search(input: SearchInput): SearchResult
  /** The document's element types, marks and inline elements, for a model */
  describe(): string
  edit(input: EditInput): EditResult
  readonly context: AgentContext
}

const DONE = new WeakMap<Editor, Map<string, EditResult>>()

/**
 * An agent's access to one editor's document: a live editor in the browser,
 * or a headless one from `createTextbitEditor`, shared through Y.js or not.
 * Give it the same plugins as the editor.
 */
export function createDocumentAgent(editor: Editor, options: AgentOptions = {}): DocumentAgent {
  const context = createContext(options)
  const pageSize = options.pageSize ?? 24000

  const view = (entries: [Element, Path][]) => formatElements(
    { schema: context.schema, names: context.names, handles: context.handles(editor.children) },
    entries
  )

  const topLevel = (): [Element, Path][] => editor.children.flatMap((node, index): [Element, Path][] =>
    Element.isElement(node) ? [[node, [index]]] : [])

  /** The top-level elements the elements with these ids are in */
  const blocksOf = (ids: string[]): [Element, Path][] => {
    const indexes = new Set<number>()
    for (const id of ids) {
      try {
        indexes.add(pathOf(editor, id)[0])
      } catch {
        // Removed by the edit
      }
    }
    return [...indexes].sort((a, b) => a - b).flatMap((index): [Element, Path][] => {
      const node = editor.children[index]
      return Element.isElement(node) ? [[node, [index]]] : []
    })
  }

  return {
    context,

    read: (input = {}) => {
      const revision = recordRevision(editor)
      const blocks = topLevel()
      let start = 0
      if (input.from) {
        const match = context.handles(editor.children).resolve(input.from)
        start = match.found ? match.path[0] : blocks.length
      }

      const limit = Math.max(1, input.limit ?? blocks.length)
      const lines: string[] = []
      let size = 0
      let end = start
      for (; end < blocks.length && end - start < limit; end++) {
        const line = view([blocks[end]])
        if (lines.length && size + line.length > pageSize) {
          break
        }
        lines.push(line)
        size += line.length + 1
      }

      const handles = context.handles(editor.children)
      return {
        revision,
        view: lines.join('\n'),
        total: blocks.length,
        ...(end < blocks.length ? { next: handles.of(blocks[end][0], blocks[end][1]) } : {})
      }
    },

    search: ({ query, limit = 20 }) => {
      const revision = recordRevision(editor)
      const needle = query.toLowerCase()
      const handles = context.handles(editor.children)
      const matches: SearchResult['matches'] = []

      for (const [node, path] of Node.nodes(editor)) {
        if (matches.length >= limit) {
          break
        }
        const holdsText = Element.isElement(node) && !Editor.isInline(editor, node) && node.children.some((child) => Text.isText(child))
        if (holdsText && Node.string(node).toLowerCase().includes(needle)) {
          const top = editor.children[path[0]]
          matches.push({
            line: view([[node, path]]).trim(),
            ...(path.length > 1 && Element.isElement(top) ? { in: handles.of(top, [path[0]]) } : {})
          })
        }
      }
      return { revision, matches }
    },

    describe: () => describeSchema(context.schema, context.names),

    edit: (input) => {
      const done = DONE.get(editor) ?? new Map<string, EditResult>()
      DONE.set(editor, done)
      if (input.opId && done.has(input.opId)) {
        return done.get(input.opId)!
      }

      const fail = (error: EditResult & { ok: false }): EditResult => error
      const current = revisionOf(editor.children)

      if (options.readOnly) {
        return fail({ ok: false, revision: current, error: { code: 'read-only', message: 'This document is read-only' } })
      }
      if (!Array.isArray(input.operations) || !input.operations.length) {
        return fail({ ok: false, revision: current, error: { code: 'invalid-operation', message: 'operations must list at least one change' } })
      }

      let plan: ReturnType<typeof planEdit>
      try {
        plan = planEdit(context, editor, input.operations)
      } catch (error) {
        if (isStepError(error)) {
          return fail({ ok: false, revision: current, error: error.error })
        }
        throw error
      }

      // Changed since the agent read it: only the elements it changes matter
      if (input.revision && input.revision !== current) {
        const targets = plan.steps.flatMap((step) => step.targets)
        const changed = changedSince(editor, input.revision, targets)
        if (changed === null || changed.length) {
          const stale = changed ?? targets
          return fail({
            ok: false,
            revision: recordRevision(editor),
            error: {
              code: 'stale',
              message: changed === null
                ? 'The document changed since that revision'
                : 'Elements this changes were changed by someone else',
              hint: 'Plan the changes again from the current content, here in view'
            },
            view: view(blocksOf(stale.length ? stale : targets))
          })
        }
      }

      const error = runEdit(editor, options.plugins, plan)
      if (error) {
        return fail({ ok: false, revision: current, error })
      }

      const result: EditResult = {
        ok: true,
        revision: recordRevision(editor),
        view: view(blocksOf([...plan.steps.flatMap((step) => step.targets), ...plan.inserted]))
      }
      if (input.opId) {
        done.set(input.opId, result)
        while (done.size > 100) {
          done.delete(done.keys().next().value!)
        }
      }
      return result
    }
  }
}
