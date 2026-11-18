import type { TBDocumentSchema as DocumentSchema, TBElementTypeSchema as ElementTypeSchema, TBPropertySchema } from '@dotvoid/textbit/headless'
import { createNames, type Names } from './names'

/** How the document reads and is written, for a model */
export const FORMAT_GUIDE = `The document is shown one element per line, children indented two spaces under their parent:
[#a1b2c3 text role="heading-1"] A title
[#d4e5f6 text] Some [bold words]{bold} and [a link]{link href="https://example.com"}.
[#0f0f0f image src="https://example.com/a.png"]
  [#11aa22 alt] What the image shows
  [#33bb44 caption] The caption
A line starts with its header: the element's handle after #, its type, and its properties (strings in double quotes). Text follows the header. [text]{marks} is marked text; [text]{type properties} an inline element. In text, write \\[ \\] \\\\ for those characters and \\n for a line break.
Refer to an element by its handle. Write new content in the same lines, without handles: the editor gives new elements their ids and adds required children you leave out.
An element marked unknown belongs to a plugin this editor does not have. Leave it as it is.`

/**
 * The element types, marks and inline elements of a schema, as a model reads
 * them, with the short names of the line format: what the `document_types`
 * tool returns. `schema` is from `getSchema(plugins)`.
 */
export function describeSchema(schema: DocumentSchema): string {
  return describeWith(schema, createNames(schema))
}

/** The same, with names an agent already has */
export function describeWith(schema: DocumentSchema, names: Names): string {
  const elements = Object.values(schema.elements)
  const top = schema.topLevel.map((type) => schema.elements[type])
  const inlines = elements.filter((element) => element.class === 'inline' && !element.parent)

  const lines = ['Top-level types:']
  for (const element of top) {
    lines.push(...describeElement(schema, names, element, '  ', names.short(element.type)))
  }

  const marks = Object.entries(schema.marks)
  if (marks.length) {
    lines.push('Marks:', ...marks.map(([mark, { description }]) => `  ${names.short(mark)}${description ? `: ${description}` : ''}`))
  }
  if (inlines.length) {
    lines.push('Inline types:')
    for (const element of inlines) {
      lines.push(...describeElement(schema, names, element, '  ', names.short(element.type)))
    }
  }
  return lines.join('\n')
}

function describeElement(
  schema: DocumentSchema,
  names: Names,
  element: ElementTypeSchema,
  indent: string,
  name: string,
  count?: string
): string[] {
  const facts: string[] = []
  if (count) {
    facts.push(count)
  }
  if (element.class === 'void') {
    facts.push('no text')
  } else if (!element.children?.length && element.class !== 'block') {
    if (!element.allowBreak) {
      facts.push('one line')
    }
    if (element.allowSoftBreak) {
      facts.push('line breaks allowed')
    }
    if (!element.marks.length) {
      facts.push('no marks')
    } else if (element.marks.length < Object.keys(schema.marks).length) {
      facts.push(`marks: ${element.marks.map((m) => names.short(m)).join(', ')}`)
    }
  }

  const head = `${indent}${name}${element.description ? `: ${element.description}` : ''}${facts.length ? ` (${facts.join('; ')})` : ''}`
  const lines = [head]

  const properties = Object.entries(element.properties ?? {})
  if (properties.length) {
    lines.push(`${indent}  properties: ${properties.map(([key, property]) => describeProperty(key, property)).join('; ')}`)
  }

  if (element.children?.length) {
    lines.push(`${indent}  children, in this order:`)
    for (const child of element.children) {
      const childSchema = schema.elements[child.type]
      if (childSchema) {
        lines.push(...describeElement(schema, names, childSchema, `${indent}    `, names.child(child.type), countOf(child.min, child.max)))
      }
    }
  }
  return lines
}

function describeProperty(name: string, property: TBPropertySchema): string {
  const parts = [property.enum ? `one of ${property.enum.map((v) => JSON.stringify(v)).join(', ')}` : property.type]
  if (property.required) {
    parts.push('required')
  }
  return `${name} (${parts.join(', ')})${property.description ? ` ${property.description}` : ''}`
}

function countOf(min?: number, max?: number): string | undefined {
  if (min !== undefined && min === max) {
    return `exactly ${min}`
  }
  if (min !== undefined && max !== undefined) {
    return `${min} to ${max}`
  }
  if (min !== undefined) {
    return `at least ${min}`
  }
  return max !== undefined ? `at most ${max}` : 'any number'
}
