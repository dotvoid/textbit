import { Editor, Element, Text, type Descendant, type Operation } from 'slate'
import type { PluginDefinition, PropertySchema } from '../types/definition'
import { createTextbitEditor } from '../editor/createTextbitEditor'
import { getSchema, type DocumentSchema, type ElementTypeSchema } from './getSchema'

/**
 * What is wrong:
 *
 * - `not-an-element`: text at the top level
 * - `unknown-type`: no plugin renders the type; kept as it is (a warning)
 * - `class-mismatch`: the element's class is not its type's
 * - `missing-id`, `duplicate-id`
 * - `misplaced`: the type does not belong where it is
 * - `invalid-children`: text where elements belong, or the other way round
 * - `too-few`, `too-many`, `out-of-order`: children against their constraints
 * - `missing-property`, `invalid-property`, `unknown-property` (a warning)
 * - `inline-not-allowed`, `mark-not-allowed`, `unknown-mark` (a warning)
 * - `would-change`: the editor would change the block when it loads (a warning)
 */
export type ValidationCode =
  | 'not-an-element'
  | 'unknown-type'
  | 'class-mismatch'
  | 'missing-id'
  | 'duplicate-id'
  | 'misplaced'
  | 'invalid-children'
  | 'too-few'
  | 'too-many'
  | 'out-of-order'
  | 'missing-property'
  | 'invalid-property'
  | 'unknown-property'
  | 'inline-not-allowed'
  | 'mark-not-allowed'
  | 'unknown-mark'
  | 'would-change'

/** Something `validate` found */
export interface ValidationIssue {
  /** What is wrong */
  code: ValidationCode
  /** An error breaks the schema; a warning is worth knowing but allowed */
  severity: 'error' | 'warning'
  /** Where, as a Slate path */
  path: number[]
  /** The element's id, when it has one */
  id?: string
  /** The element's type */
  type?: string
  /** What is wrong, and where it can say, what would be right */
  message: string
}

/**
 * Check a document against an editor's plugins, without changing it.
 *
 * Reports what breaks the schema from `getSchema`: types, classes, ids, where
 * elements stand, child counts and order, properties, marks and inline
 * elements. Then normalizes a copy as the editor would, and reports each
 * top-level block that would change: the plugins' own rules, such as a list's,
 * live in code, not in the schema.
 *
 * An element whose plugin is missing is reported as a warning and not looked
 * into: such content is kept as it is.
 */
export function validate(document: Descendant[], plugins?: PluginDefinition[]): ValidationIssue[] {
  const schema = getSchema(plugins)
  const issues: ValidationIssue[] = []
  const ids = new Map<string, number[]>()

  document.forEach((node, index) => {
    const path = [index]
    if (!Element.isElement(node)) {
      issues.push(issue('not-an-element', 'error', path, 'A top-level node must be an element, not text'))
      return
    }
    const known = schema.elements[node.type]
    if (known && !schema.topLevel.includes(node.type)) {
      issues.push(issue('misplaced', 'error', path, `${node.type} cannot stand at the top level`, node, {
        hint: known.parent ? `It belongs in ${known.parent}` : 'It belongs inside text'
      }))
    }
    checkElement(schema, node, path, issues, ids)
  })

  return [...issues, ...normalizationChanges(document, plugins)]
}

function checkElement(
  schema: DocumentSchema,
  node: Element,
  path: number[],
  issues: ValidationIssue[],
  ids: Map<string, number[]>
): void {
  if (typeof node.id === 'string') {
    const first = ids.get(node.id)
    if (first) {
      issues.push(issue('duplicate-id', 'error', path, `The id ${node.id} is also used at [${first.join(', ')}]`, node))
    } else {
      ids.set(node.id, path)
    }
  }

  const known = schema.elements[node.type]
  if (!known) {
    issues.push(issue('unknown-type', 'warning', path, `No plugin renders ${node.type || 'an element without a type'}; it is kept as it is`, node))
    return
  }

  if (node.class !== known.class) {
    issues.push(issue('class-mismatch', 'error', path, `${node.type} has class ${known.class}, not ${node.class}`, node))
  }
  if (known.class !== 'text' && typeof node.id !== 'string') {
    issues.push(issue('missing-id', 'error', path, `${node.type} needs an id`, node))
  }

  checkProperties(known, node, path, issues)

  if (known.class === 'void') {
    return
  }
  // An element with child types holds them, whatever its class: a list is
  // text, and holds list items
  if (!known.children?.length && (known.class === 'text' || known.class === 'inline')) {
    checkText(schema, known, node, path, issues, ids)
    return
  }
  checkBlockChildren(schema, known, node, path, issues, ids)
}

function checkProperties(known: ElementTypeSchema, node: Element, path: number[], issues: ValidationIssue[]): void {
  if (!known.properties) {
    return
  }
  const properties: Record<string, unknown> = node.properties ?? {}

  for (const [name, property] of Object.entries(known.properties)) {
    if (property.required && properties[name] === undefined) {
      issues.push(issue('missing-property', 'error', path, `${node.type} needs the property ${name}`, node))
    }
  }
  for (const [name, value] of Object.entries(properties)) {
    if (value === undefined) {
      continue
    }
    const property = known.properties[name]
    if (!property) {
      issues.push(issue('unknown-property', 'warning', path, `${node.type} does not declare the property ${name}`, node))
    } else if (!fits(property, value)) {
      issues.push(issue('invalid-property', 'error', path, `${node.type}'s ${name} must be ${expected(property)}`, node))
    }
  }
}

function checkText(
  schema: DocumentSchema,
  known: ElementTypeSchema,
  node: Element,
  path: number[],
  issues: ValidationIssue[],
  ids: Map<string, number[]>
): void {
  node.children.forEach((child, index) => {
    const childPath = [...path, index]
    if (Text.isText(child)) {
      checkMarks(schema, known, node, child, childPath, issues)
      return
    }

    const inline = schema.elements[child.type]
    if (inline && inline.class !== 'inline') {
      issues.push(issue('invalid-children', 'error', childPath, `${node.type} holds text and inline elements, not ${child.type}`, child))
      return
    }
    if (inline && !known.inlines.includes(child.type)) {
      issues.push(issue('inline-not-allowed', 'error', childPath, `${node.type} does not allow ${child.type}`, child))
    }
    checkElement(schema, child, childPath, issues, ids)
  })
}

function checkMarks(
  schema: DocumentSchema,
  known: ElementTypeSchema,
  node: Element,
  text: Text,
  path: number[],
  issues: ValidationIssue[]
): void {
  for (const [key, value] of Object.entries(text)) {
    // Marks are named like plugins; other keys are the editor's own
    if (key === 'text' || !key.includes('/') || !value) {
      continue
    }
    if (!schema.marks[key]) {
      issues.push(issue('unknown-mark', 'warning', path, `No plugin provides the mark ${key}`))
    } else if (!known.marks.includes(key)) {
      issues.push(issue('mark-not-allowed', 'error', path, `${node.type} does not allow the mark ${key}`))
    }
  }
}

function checkBlockChildren(
  schema: DocumentSchema,
  known: ElementTypeSchema,
  node: Element,
  path: number[],
  issues: ValidationIssue[],
  ids: Map<string, number[]>
): void {
  if (node.children.some((child) => Text.isText(child))) {
    issues.push(issue('invalid-children', 'error', path, `${node.type} holds elements, not text`, node))
    return
  }

  const declared = known.children?.map((child) => child.type) ?? []
  let rank = -1

  node.children.forEach((child, index) => {
    const childPath = [...path, index]
    if (!Element.isElement(child)) {
      return
    }
    const childSchema = schema.elements[child.type]
    if (childSchema && declared.length && !declared.includes(child.type)) {
      issues.push(issue('misplaced', 'error', childPath, `${child.type} does not belong in ${node.type}`, child, {
        hint: `${node.type} holds ${declared.join(', ')}`
      }))
    } else if (childSchema && declared.length) {
      const childRank = declared.indexOf(child.type)
      if (childRank < rank) {
        issues.push(issue('out-of-order', 'error', childPath, `${child.type} comes before ${declared[rank]} in ${node.type}`, child))
      }
      rank = Math.max(rank, childRank)
    }
    checkElement(schema, child, childPath, issues, ids)
  })

  for (const { type, min, max } of known.children ?? []) {
    const count = node.children.filter((child) => Element.isElement(child) && child.type === type).length
    if (min !== undefined && count < min) {
      issues.push(issue('too-few', 'error', path, `${node.type} needs at least ${min} ${type}, it has ${count}`, node))
    }
    if (max !== undefined && count > max) {
      issues.push(issue('too-many', 'error', path, `${node.type} takes at most ${max} ${type}, it has ${count}`, node))
    }
  }
}

/** The top-level blocks normalizing a copy of the document would change */
function normalizationChanges(document: Descendant[], plugins?: PluginDefinition[]): ValidationIssue[] {
  const editor = createTextbitEditor({ plugins, value: structuredClone(document) })
  const operations: Operation[] = []
  const { apply } = editor
  editor.apply = (operation) => {
    operations.push(operation)
    apply(operation)
  }

  try {
    Editor.normalize(editor, { force: true })
  } catch (error) {
    return [issue('would-change', 'error', [], `Normalizing the document fails: ${String(error)}`)]
  }

  const byBlock = new Map<number, Set<string>>()
  for (const operation of operations) {
    if (!('path' in operation) || !operation.path.length) {
      continue
    }
    const index = operation.path[0]
    byBlock.set(index, (byBlock.get(index) ?? new Set()).add(operation.type))
  }

  return [...byBlock].map(([index, types]) => {
    const node = document[index]
    return issue(
      'would-change',
      'warning',
      [index],
      `The editor would change this block when it loads (${[...types].join(', ')})`,
      Element.isElement(node) ? node : undefined
    )
  })
}

function fits(property: PropertySchema, value: unknown): boolean {
  return typeof value === property.type
    && (!property.enum || property.enum.includes(value as string | number))
}

function expected(property: PropertySchema): string {
  return property.enum ? `one of ${property.enum.map((v) => JSON.stringify(v)).join(', ')}` : `a ${property.type}`
}

function issue(
  code: ValidationCode,
  severity: ValidationIssue['severity'],
  path: number[],
  message: string,
  node?: Element,
  extra?: { hint?: string }
): ValidationIssue {
  return {
    code,
    severity,
    path,
    ...(node && typeof node.id === 'string' ? { id: node.id } : {}),
    ...(node?.type ? { type: node.type } : {}),
    message: extra?.hint ? `${message}. ${extra.hint}` : message
  }
}
