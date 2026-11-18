import { Element, Node, Text, type Descendant, type Path } from 'slate'
import type { TBDocumentSchema as DocumentSchema } from '@dotvoid/textbit/headless'
import type { Names } from './names'
import type { Handles } from './handles'

/*
 * The document as an agent reads and writes it: one line per element, its
 * children indented under it by two spaces.
 *
 *   [#a1b2c3 text role="heading-1"] A harbour town
 *   [#d4e5f6 text] Some [bold]{bold} words and [a link]{link href="https://x"}.
 *   [#0f0f0f image src="https://example.com/a.png"]
 *     [#11aa22 alt] Hills above the harbour
 *     [#33bb44 caption] The harbour in January
 *   [#99ee00 acme/factbox unknown] "Its text, which cannot be edited"
 *
 * A line starts with its header in brackets: the element's handle after #,
 * its type and its properties, strings in double quotes. Text follows the
 * header. Marked text is [text]{marks}, an inline element [text]{type
 * properties #handle}. In text, \[, \] and \\ stand for those characters and
 * \n for a line break.
 *
 * Writing new content uses the same lines; a handle is only given to refer to
 * an existing element.
 */

export interface FormatContext {
  schema: DocumentSchema
  names: Names
  handles: Handles
}

/** Lines for elements, their children indented under them */
export function formatElements(context: FormatContext, entries: [Element, Path][]): string {
  return entries.map(([element, path]) => formatElement(context, element, path, 0)).join('\n')
}

function formatElement(context: FormatContext, element: Element, path: Path, depth: number): string {
  const { schema, names, handles } = context
  const known = schema.elements[element.type]
  const indent = '  '.repeat(depth)
  const name = !known ? element.type : known.parent ? names.child(element.type) : names.short(element.type)
  const header = [`#${handles.of(element, path)}`, name, ...formatProperties(element.properties)]

  if (!known) {
    const text = Node.string(element)
    return `${indent}[${[...header, 'unknown'].join(' ')}]${text ? ` ${JSON.stringify(truncate(text))}` : ''}`
  }

  const line = `${indent}[${header.join(' ')}]`
  if (known.class === 'void') {
    return line
  }
  if (holdsText(context, element)) {
    const text = formatInline(context, element.children, path)
    return text ? `${line} ${text}` : line
  }
  return [line, ...element.children.flatMap((child, index) => Element.isElement(child)
    ? [formatElement(context, child, [...path, index], depth + 1)]
    : [])].join('\n')
}

/** Whether an element's children are text: a text or inline element without child types */
function holdsText(context: FormatContext, element: Element): boolean {
  const known = context.schema.elements[element.type]
  return !!known && !known.children?.length && (known.class === 'text' || known.class === 'inline')
}

function formatInline(context: FormatContext, children: Descendant[], path: Path): string {
  return children.map((child, index) => {
    if (Text.isText(child)) {
      const marks = Object.keys(child)
        .filter((key) => key !== 'text' && key.includes('/') && child[key])
        .map((mark) => context.names.short(mark))
      const text = escapeText(child.text)
      return marks.length && text ? `[${text}]{${marks.join(' ')}}` : text
    }
    const known = context.schema.elements[child.type]
    const header = [
      known ? context.names.short(child.type) : child.type,
      ...formatProperties(child.properties),
      `#${context.handles.of(child, [...path, index])}`,
      ...known ? [] : ['unknown']
    ]
    return `[${formatInline(context, child.children, [...path, index])}]{${header.join(' ')}}`
  }).join('')
}

function formatProperties(properties: Element['properties']): string[] {
  return Object.entries(properties ?? {})
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${typeof value === 'string' ? JSON.stringify(value) : String(value)}`)
}

function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/\n/g, '\\n')
}

function truncate(text: string): string {
  return text.length > 200 ? `${text.slice(0, 200)}…` : text
}

/* -------------------------------------------------------------------------- */

/** Content as parsed: elements with new ids, or a handle where one was given */
export interface ParsedElement {
  handle?: string
  element: Element
}

export class FormatError extends Error {
  constructor(message: string, readonly line: number) {
    super(`Line ${line}: ${message}`)
  }
}

/**
 * Elements from lines of the format. Top-level lines are elements that may
 * stand where they are placed: `parent` is the full type they are children
 * of, or undefined at the top level. Lines indented under a line are its
 * children, read in its context.
 */
export function parseElements(schema: DocumentSchema, names: Names, source: string, parent?: string): ParsedElement[] {
  const lines = source.split('\n')
    .map((text, index) => ({ text, number: index + 1 }))
    .filter((line) => line.text.trim() !== '')
  if (!lines.length) {
    throw new FormatError('no content', 1)
  }
  const base = indentOf(lines[0].text)
  let position = 0

  const level = (depth: number, parentType: string | undefined): ParsedElement[] => {
    const parsed: ParsedElement[] = []
    while (position < lines.length) {
      const line = lines[position]
      const indent = indentOf(line.text) - base
      if (indent < depth * 2) {
        break
      }
      if (indent !== depth * 2) {
        throw new FormatError('children are indented by two spaces under their parent', line.number)
      }
      position++
      parsed.push(parseOne(schema, names, line.text.trim(), line.number, parentType, (type) => level(depth + 1, type)))
    }
    return parsed
  }

  const parsed = level(0, parent)
  if (position < lines.length) {
    throw new FormatError('the first line is indented further than this one', lines[position].number)
  }
  return parsed
}

function parseOne(
  schema: DocumentSchema,
  names: Names,
  text: string,
  number: number,
  parent: string | undefined,
  parseChildren: (type: string) => ParsedElement[]
): ParsedElement {
  if (!text.startsWith('[')) {
    throw new FormatError('a line starts with its header, such as [text] or [#a1b2c3 caption]', number)
  }
  const end = headerEnd(text)
  if (end < 0) {
    throw new FormatError('the header has no closing ]', number)
  }

  const tokens = tokenize(text.slice(1, end), number)
  const handle = tokens[0]?.startsWith('#') ? tokens.shift()!.slice(1) : undefined
  const name = tokens.shift()
  if (!name || name.includes('=')) {
    throw new FormatError('the header names a type, such as [text] or [image src="..."]', number)
  }
  if (tokens.includes('unknown')) {
    throw new FormatError('an element whose plugin is missing cannot be written', number)
  }

  const type = parent ? names.childType(parent, name) : names.type(name)
  if (!type) {
    const allowed = parent
      ? (schema.elements[parent]?.children ?? []).map((child) => names.child(child.type))
      : schema.topLevel.map((t) => names.short(t))
    const where = parent ? `in ${names.short(parent)}` : 'at the top level'
    throw new FormatError(`${name} cannot stand ${where}; it can be one of: ${allowed.join(', ')}`, number)
  }

  const known = schema.elements[type]
  const properties = parseProperties(tokens, number)
  const rest = text.slice(end + 1).replace(/^ /, '')
  const children = parseChildren(type)

  const element = {
    id: crypto.randomUUID(),
    type,
    class: known.class,
    properties,
    children: [] as Descendant[]
  } as Element

  if (known.class === 'void') {
    if (children.length || rest.trim()) {
      throw new FormatError(`${name} holds neither text nor elements`, number)
    }
    element.children = [{ text: '' }]
  } else if (!known.children?.length && (known.class === 'text' || known.class === 'inline')) {
    if (children.length) {
      throw new FormatError(`${name} holds text, not elements`, number)
    }
    element.children = parseInline(schema, names, rest, number)
  } else {
    if (rest.trim()) {
      throw new FormatError(`${name} holds elements on the lines under it, not text`, number)
    }
    // Required children the lines leave out are added by the editor
    element.children = children.map((child) => child.element)
  }

  return { ...(handle ? { handle } : {}), element }
}

/** Parse inline content: text, [text]{marks} and [content]{inline-type props} */
export function parseInline(schema: DocumentSchema, names: Names, source: string, line: number): Descendant[] {
  let position = 0

  const parseRun = (closing: boolean): Descendant[] => {
    const nodes: Descendant[] = []
    let text = ''
    const flush = () => {
      if (text) {
        nodes.push({ text })
        text = ''
      }
    }

    while (position < source.length) {
      const char = source[position]
      if (char === '\\') {
        const next = source[position + 1]
        if (next === undefined) {
          throw new FormatError('a \\ at the end of the text stands for nothing; write \\\\ for a backslash', line)
        }
        text += next === 'n' ? '\n' : next
        position += 2
      } else if (char === ']') {
        if (!closing) {
          throw new FormatError('a ] without its [; write \\] for the character', line)
        }
        flush()
        return nodes
      } else if (char === '[') {
        flush()
        position++
        const inner = parseRun(true)
        if (source[position] !== ']') {
          throw new FormatError('a [ without its ]; write \\[ for the character', line)
        }
        position++
        if (source[position] !== '{') {
          throw new FormatError('[text] is followed by {marks} or {inline-type ...}; write \\[ for the character', line)
        }
        const close = closingBrace(source, position)
        if (close < 0) {
          throw new FormatError('a { without its }', line)
        }
        const tokens = tokenize(source.slice(position + 1, close), line)
        position = close + 1
        nodes.push(...applyBraces(schema, names, inner, tokens, line))
      } else {
        text += char
        position++
      }
    }

    if (closing) {
      throw new FormatError('a [ without its ]; write \\[ for the character', line)
    }
    flush()
    return nodes
  }

  const nodes = parseRun(false)
  return nodes.length ? nodes : [{ text: '' }]
}

function applyBraces(schema: DocumentSchema, names: Names, inner: Descendant[], tokens: string[], line: number): Descendant[] {
  const first = tokens[0]
  const inlineType = first ? names.type(first) : undefined

  if (inlineType && schema.elements[inlineType]?.class === 'inline') {
    const rest = tokens.slice(1).filter((token) => !token.startsWith('#'))
    if (rest.includes('unknown')) {
      throw new FormatError('an inline element whose plugin is missing cannot be written', line)
    }
    return [{
      id: crypto.randomUUID(),
      type: inlineType,
      class: 'inline',
      properties: parseProperties(rest, line),
      children: inner.length ? inner : [{ text: '' }]
    } as Element]
  }

  const marks = tokens.map((token) => {
    const mark = names.mark(token)
    if (!mark) {
      const known = Object.keys(schema.marks).map((m) => names.short(m))
      throw new FormatError(`${token} is neither a mark nor an inline type; marks: ${known.join(', ') || 'none'}`, line)
    }
    return mark
  })
  return inner.map((node) => {
    if (!Text.isText(node)) {
      throw new FormatError('marks apply to text; put the inline element outside, or the marks inside it', line)
    }
    return { ...node, ...Object.fromEntries(marks.map((mark) => [mark, true])) }
  })
}

/** The index of the } that closes the braces opening at `start`, quotes skipped */
function closingBrace(source: string, start: number): number {
  let quoted = false
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === '\\' && quoted) {
      i++
    } else if (source[i] === '"') {
      quoted = !quoted
    } else if (source[i] === '}' && !quoted) {
      return i
    }
  }
  return -1
}

/** The index of the ] that closes a line's header, quotes skipped */
function headerEnd(text: string): number {
  let quoted = false
  for (let i = 1; i < text.length; i++) {
    if (text[i] === '\\' && quoted) {
      i++
    } else if (text[i] === '"') {
      quoted = !quoted
    } else if (text[i] === ']' && !quoted) {
      return i
    }
  }
  return -1
}

/** Space-separated tokens, a double-quoted value with spaces kept whole */
function tokenize(source: string, line: number): string[] {
  const tokens = source.match(/[^\s"=]+="(?:[^"\\]|\\.)*"|"(?:[^"\\]|\\.)*"|[^\s]+/g) ?? []
  for (const token of tokens) {
    if ((token.match(/"/g)?.length ?? 0) % 2) {
      throw new FormatError(`unbalanced quotes in ${token}`, line)
    }
  }
  return tokens
}

function parseProperties(tokens: string[], line: number): Record<string, string | number | boolean> {
  const properties: Record<string, string | number | boolean> = {}
  for (const token of tokens) {
    const equals = token.indexOf('=')
    if (equals <= 0) {
      throw new FormatError(`${token} is not a property; write name=value, strings in double quotes`, line)
    }
    properties[token.slice(0, equals)] = parseValue(token.slice(equals + 1), line)
  }
  return properties
}

/** A property value: a JSON string, a number, true or false */
export function parseValue(raw: string, line: number): string | number | boolean {
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw) as string
    } catch {
      throw new FormatError(`${raw} is not a valid string`, line)
    }
  }
  if (raw === 'true' || raw === 'false') {
    return raw === 'true'
  }
  const number = Number(raw)
  if (raw !== '' && Number.isFinite(number)) {
    return number
  }
  throw new FormatError(`${raw} is not a value; put strings in double quotes`, line)
}

function indentOf(text: string): number {
  return text.length - text.trimStart().length
}
