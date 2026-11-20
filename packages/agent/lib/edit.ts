import { Editor, Element, Node, Path, Text, Transforms, type Point } from 'slate'
import { createTextbitEditor, validate, type TBPluginDefinition, type TBValidationIssue as ValidationIssue } from '@dotvoid/textbit/headless'
import type { AgentContext } from './context'
import { parseElements, FormatError, type ParsedElement } from './format'

/** Where content goes: after or before an element, at the end of one, or at the end of the document */
export interface Placement {
  /** After this element, by handle */
  after?: string
  /** Before this element, by handle */
  before?: string
  /** Last inside this element, by handle. With none of the three: at the end of the document. */
  into?: string
}

/**
 * One change. Elements are named by their handle. Content is written in the
 * document's line format, see FORMAT_GUIDE.
 */
export type EditOperation =
  | {
    /** Replace an element with new content */
    op: 'replace'
    /** The element's handle */
    id: string
    /** The new element or elements, in the line format */
    content: string
  }
  | ({
    /** Insert new content */
    op: 'insert'
    /** The new element or elements, in the line format */
    content: string
  } & Placement)
  | {
    /** Delete an element */
    op: 'delete'
    /** The element's handle */
    id: string
  }
  | ({
    /** Move an element */
    op: 'move'
    /** The element's handle */
    id: string
  } & Placement)
  | {
    /** Set or remove properties of an element */
    op: 'setProperties'
    /** The element's handle */
    id: string
    /** The properties to set; `null` removes one */
    properties: Record<string, string | number | boolean | null>
  }
  | {
    /** Replace text inside an element, leaving the rest of it as it is */
    op: 'replaceText'
    /** The element's handle */
    id: string
    /** The text to find; it must be there, and once unless `all` */
    find: string
    /** The text to put in its place */
    replace: string
    /** Replace every occurrence. Default: `false`. */
    all?: boolean
  }

/**
 * Why an edit failed:
 *
 * - `read-only`: the agent may only read
 * - `not-found`: no element has the handle, or an earlier operation removed it
 * - `ambiguous-id`: the handle fits more than one element
 * - `invalid-operation`: an operation is malformed
 * - `parse-error`: content is not valid line format
 * - `not-allowed`: not possible here, e.g. changing an element whose plugin is
 *   missing, or suggesting without a fork to suggest in
 * - `text-not-found`, `text-ambiguous`: `find` is not there, or there more than once
 * - `invalid-content`: the result would break the document's rules (see `issues`)
 * - `stale`: what the edit touches changed since `revision`
 */
export type EditErrorCode =
  | 'read-only'
  | 'not-found'
  | 'ambiguous-id'
  | 'invalid-operation'
  | 'parse-error'
  | 'not-allowed'
  | 'text-not-found'
  | 'text-ambiguous'
  | 'invalid-content'
  | 'stale'

/** What went wrong with an edit, for a model to read and correct */
export interface EditError {
  /** What kind of failure */
  code: EditErrorCode
  /** What went wrong, in a sentence */
  message: string
  /** The operation it concerns, by its index in the batch */
  operation?: number
  /** What would be right, where there is something to say */
  hint?: string
  /** The issues found, for invalid-content */
  issues?: {
    /** The validation code, as `TBValidationCode` */
    code: string
    /** The id of the element it concerns */
    element?: string
    /** What is wrong */
    message: string
  }[]
}

/** What `edit` gives: the changed elements on success, else the error */
export type EditResult =
  | {
    /** The changes were made, or suggested */
    ok: true
    /** The revision now of what the agent works in: the document, or while it suggests, its fork */
    revision: string
    /** The top-level elements changed, in the line format, with their handles */
    view: string
  }
  | {
    /** Nothing was changed */
    ok: false
    /** The document's revision now */
    revision: string
    /** What went wrong */
    error: EditError
    /** For `stale`: the elements as they are now */
    view?: string
  }

/** A step of a batch: what it changes, and how, given ids */
interface Step {
  targets: string[]
  run: (editor: Editor) => void
}

class StepError extends Error {
  constructor(readonly error: EditError) {
    super(error.message)
  }
}

/**
 * Plan a batch: resolve handles to ids, parse content, and check what can be
 * checked before anything changes. Throws a StepError for the first problem.
 */
export function planEdit(context: AgentContext, editor: Editor, operations: EditOperation[]): {
  steps: Step[]
  /** Ids given to elements that had none, which the batch then refers to */
  assignIds: { path: Path, id: string }[]
  inserted: string[]
} {
  const handles = context.handles(editor.children)
  const assignIds: { path: Path, id: string }[] = []
  const inserted: string[] = []

  const resolve = (handle: unknown, operation: number, what = 'id'): { id: string, path: Path, element: Element } => {
    if (typeof handle !== 'string' || !handle) {
      throw new StepError({ code: 'invalid-operation', operation, message: `${what} must be an element's handle` })
    }
    const match = handles.resolve(handle)
    if (!match.found) {
      throw new StepError(match.reason === 'ambiguous'
        ? { code: 'ambiguous-id', operation, message: `${handle} could be ${match.candidates?.join(' or ')}`, hint: 'Use one of those handles' }
        : { code: 'not-found', operation, message: `No element ${handle}`, hint: 'Read the document again for the current handles' })
    }
    if (match.id) {
      return { id: match.id, path: match.path, element: match.element }
    }
    // An element without an id gets one, so the rest of the batch can find it
    const assigned = assignIds.find((entry) => Path.equals(entry.path, match.path))
    const id = assigned?.id ?? crypto.randomUUID()
    if (!assigned) {
      assignIds.push({ path: match.path, id })
    }
    return { id, path: match.path, element: match.element }
  }

  const parse = (content: unknown, parent: string | undefined, operation: number): ParsedElement[] => {
    if (typeof content !== 'string') {
      throw new StepError({ code: 'invalid-operation', operation, message: 'content must be lines of the document format' })
    }
    try {
      const parsed = parseElements(context.schema, context.names, content, parent)
      inserted.push(...parsed.map((p) => p.element.id).filter((id): id is string => typeof id === 'string'))
      return parsed
    } catch (error) {
      if (error instanceof FormatError) {
        throw new StepError({ code: 'parse-error', operation, message: error.message })
      }
      throw error
    }
  }

  const guardUnknown = (element: Element, operation: number, verb: string) => {
    if (context.options.unknownElements === 'all') {
      return
    }
    const unknown = [element, ...[...Node.elements(element)].map(([node]) => node)]
      .find((node) => Element.isElement(node) && !context.schema.elements[node.type])
    if (unknown) {
      throw new StepError({
        code: 'not-allowed',
        operation,
        message: `Cannot ${verb} ${unknown.type}: its plugin is missing here, and it is kept as it is`,
        hint: 'Leave it, or move it'
      })
    }
  }

  /** The parent type of the element at a path, for parsing content placed beside it */
  const parentType = (path: Path): string | undefined => {
    if (path.length < 2) {
      return undefined
    }
    const parent = Node.get(editor, Path.parent(path))
    return Element.isElement(parent) ? parent.type : undefined
  }

  /** Where placed content goes, and the type of its parent */
  const place = (placement: Placement, operation: number): { parent?: string, at: (editor: Editor) => Path } => {
    const given = (['after', 'before', 'into'] as const).filter((key) => placement[key] !== undefined)
    if (given.length > 1) {
      throw new StepError({ code: 'invalid-operation', operation, message: 'Give one of after, before or into' })
    }
    if (!given.length) {
      return { at: (target) => [target.children.length] }
    }
    const key = given[0]
    const anchor = resolve(placement[key], operation, key)
    if (key === 'into') {
      return {
        parent: anchor.element.type,
        at: (target) => {
          const path = pathOf(target, anchor.id)
          return [...path, (Node.get(target, path) as Element).children.length]
        }
      }
    }
    return {
      parent: parentType(anchor.path),
      at: (target) => key === 'after' ? Path.next(pathOf(target, anchor.id)) : pathOf(target, anchor.id)
    }
  }

  const steps = operations.map((operation, index): Step => {
    switch (operation?.op) {
      case 'replace': {
        const target = resolve(operation.id, index)
        guardUnknown(target.element, index, 'replace')
        const parsed = parse(operation.content, parentType(target.path), index)
        // One element in place of one keeps its id, so the handle stays: so
        // does content copied from a read, with the element's own handle
        const named = parsed.length === 1 && parsed[0].handle !== undefined
          ? handles.resolve(parsed[0].handle)
          : undefined
        const own = named?.found === true && Path.equals(named.path, target.path)
        if (named && !own) {
          throw new StepError({
            code: 'invalid-operation',
            operation: index,
            message: `The content names another element, #${parsed[0].handle}`,
            hint: 'Leave the handle out of new content, or give the element\'s own'
          })
        }
        if (parsed.length === 1 && (!parsed[0].handle || own)) {
          inserted.splice(inserted.indexOf(parsed[0].element.id as string), 1)
          parsed[0].element.id = target.id
        }
        return {
          targets: [target.id],
          run: (editor) => {
            const path = pathOf(editor, target.id)
            Transforms.removeNodes(editor, { at: path })
            Transforms.insertNodes(editor, parsed.map((p) => structuredClone(p.element)), { at: path })
          }
        }
      }

      case 'insert': {
        const where = place(operation, index)
        const parsed = parse(operation.content, where.parent, index)
        return {
          targets: [],
          run: (editor) => {
            Transforms.insertNodes(editor, parsed.map((p) => structuredClone(p.element)), { at: where.at(editor) })
          }
        }
      }

      case 'delete': {
        const target = resolve(operation.id, index)
        guardUnknown(target.element, index, 'delete')
        return {
          targets: [target.id],
          run: (editor) => Transforms.removeNodes(editor, { at: pathOf(editor, target.id) })
        }
      }

      case 'move': {
        const target = resolve(operation.id, index)
        const where = place(operation, index)
        return {
          targets: [target.id],
          run: (editor) => {
            const from = pathOf(editor, target.id)
            const node = structuredClone(Node.get(editor, from)) as Element
            Transforms.removeNodes(editor, { at: from })
            Transforms.insertNodes(editor, node, { at: where.at(editor) })
          }
        }
      }

      case 'setProperties': {
        const target = resolve(operation.id, index)
        guardUnknown(target.element, index, 'change')
        const changes = operation.properties
        if (!changes || typeof changes !== 'object') {
          throw new StepError({ code: 'invalid-operation', operation: index, message: 'properties must be an object; null removes one' })
        }
        return {
          targets: [target.id],
          run: (editor) => {
            const path = pathOf(editor, target.id)
            const element = Node.get(editor, path) as Element
            const properties: Record<string, string | number | boolean> = { ...element.properties as Record<string, string | number | boolean> }
            for (const [key, value] of Object.entries(changes)) {
              if (value === null) {
                delete properties[key]
              } else {
                properties[key] = value
              }
            }
            Transforms.setNodes(editor, { properties }, { at: path })
          }
        }
      }

      case 'replaceText': {
        const target = resolve(operation.id, index)
        guardUnknown(target.element, index, 'change')
        if (typeof operation.find !== 'string' || !operation.find || typeof operation.replace !== 'string') {
          throw new StepError({ code: 'invalid-operation', operation: index, message: 'find must be text in the element, replace the text to put there' })
        }
        const count = occurrences(Node.string(target.element), operation.find)
        if (!count) {
          throw new StepError({
            code: 'text-not-found',
            operation: index,
            message: `${JSON.stringify(operation.find)} is not in ${handles.of(target.element, target.path)}`,
            hint: `Its text is ${JSON.stringify(truncate(Node.string(target.element)))}`
          })
        }
        if (count > 1 && !operation.all) {
          throw new StepError({
            code: 'text-ambiguous',
            operation: index,
            message: `${JSON.stringify(operation.find)} is there ${count} times`,
            hint: 'Quote more of the text, or set all to replace each'
          })
        }
        return {
          targets: [target.id],
          run: (editor) => replaceText(editor, pathOf(editor, target.id), operation.find, operation.replace, index)
        }
      }

      default:
        throw new StepError({
          code: 'invalid-operation',
          operation: index,
          message: `Unknown op ${JSON.stringify((operation as { op?: unknown })?.op)}`,
          hint: 'One of replace, insert, delete, move, setProperties, replaceText'
        })
    }
  })

  return { steps, assignIds, inserted }
}

/**
 * Run a planned batch on a copy, check the result against the schema, then
 * run it on the editor, so the editor changes completely or not at all.
 */
export function runEdit(
  editor: Editor,
  plugins: TBPluginDefinition[] | undefined,
  plan: ReturnType<typeof planEdit>,
  /** How the changes run on the editor itself; null leaves it as it is, to suggest them */
  live: ((change: () => void) => void) | null = (change) => change()
): { error: EditError } | { copy: Editor } {
  const run = (target: Editor) => {
    Editor.withoutNormalizing(target, () => {
      for (const { path, id } of plan.assignIds) {
        Transforms.setNodes(target, { id }, { at: path })
      }
      plan.steps.forEach((step) => step.run(target))
    })
  }

  const copy = createTextbitEditor({ plugins, value: structuredClone(editor.children) })
  try {
    run(copy)
  } catch (error) {
    return {
      error: error instanceof StepError
        ? error.error
        : { code: 'invalid-operation', message: `The changes cannot be made: ${String(error)}` }
    }
  }

  const before = new Set(errors(validate(editor.children, plugins)).map(key))
  const added = errors(validate(copy.children, plugins)).filter((issue) => !before.has(key(issue)))
  if (added.length) {
    return {
      error: {
        code: 'invalid-content',
        message: 'The result would break the document\'s rules; nothing was changed',
        issues: added.map((issue) => ({
          code: issue.code,
          ...(issue.id ? { element: issue.id } : {}),
          message: issue.message
        }))
      }
    }
  }

  live?.(() => run(editor))
  return { copy }
}

export function isStepError(error: unknown): error is StepError {
  return error instanceof StepError
}

/** The path of the element with an id */
export function pathOf(editor: Editor, id: string): Path {
  const [entry] = Editor.nodes(editor, { at: [], match: (node) => Element.isElement(node) && node.id === id })
  if (!entry) {
    throw new StepError({ code: 'not-found', message: `No element ${id.slice(0, 8)} any more`, hint: 'An earlier operation in the batch removed it' })
  }
  return entry[1]
}

function replaceText(editor: Editor, path: Path, find: string, replace: string, operation: number): void {
  const element = Node.get(editor, path) as Element
  const text = Node.string(element)
  const starts: number[] = []
  for (let at = text.indexOf(find); at >= 0; at = text.indexOf(find, at + find.length)) {
    starts.push(at)
  }

  // From the last, so earlier offsets stay right
  for (const start of starts.reverse()) {
    // The start in the text it begins, so the replacement takes its marks
    const anchor = pointAt(element, path, start, 'start')
    const focus = pointAt(element, path, start + find.length, 'end')
    if (!sameTextBlock(editor, anchor.path, focus.path)) {
      throw new StepError({
        code: 'invalid-operation',
        operation,
        message: `${JSON.stringify(find)} runs across two fields`,
        hint: 'Replace the text of each field on its own'
      })
    }
    if (replace) {
      Transforms.insertText(editor, replace, { at: { anchor, focus } })
    } else {
      Transforms.delete(editor, { at: { anchor, focus } })
    }
  }
}

/**
 * The point at a character offset in an element's text. At the boundary of
 * two texts, the start of a range lies in the second, its end in the first.
 */
export function pointAt(element: Element, path: Path, offset: number, edge: 'start' | 'end'): Point {
  let remaining = offset
  let last: Point | undefined
  for (const [text, textPath] of Node.texts(element)) {
    if (edge === 'start' ? remaining < text.text.length : remaining <= text.text.length) {
      return { path: [...path, ...textPath], offset: remaining }
    }
    remaining -= text.text.length
    last = { path: [...path, ...textPath], offset: text.text.length }
  }
  return last ?? { path, offset: 0 }
}

/** Whether two text paths lie in the same text-holding element */
function sameTextBlock(editor: Editor, a: Path, b: Path): boolean {
  const block = (path: Path) => Editor.above(editor, {
    at: path,
    match: (node) => Element.isElement(node) && !Editor.isInline(editor, node) && node.children.some((child) => Text.isText(child))
  })?.[1]
  const first = block(a)
  const second = block(b)
  return !!first && !!second && Path.equals(first, second)
}

function occurrences(text: string, find: string): number {
  let count = 0
  for (let at = text.indexOf(find); at >= 0; at = text.indexOf(find, at + find.length)) {
    count++
  }
  return count
}

function errors(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => issue.severity === 'error')
}

function key(issue: ValidationIssue): string {
  return `${issue.code}|${issue.id ?? issue.path.join('.')}|${issue.message}`
}

function truncate(text: string): string {
  return text.length > 300 ? `${text.slice(0, 300)}…` : text
}

