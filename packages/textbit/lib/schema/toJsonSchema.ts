import type { DocumentSchema, ElementTypeSchema } from './getSchema'

/** A JSON Schema, as plain data */
export type JsonSchema = { [key: string]: JsonValue }
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/**
 * A JSON Schema (draft 2020-12) for documents of an editor: an array of
 * top-level elements. Each element type has a definition in `$defs`, named by
 * its type. Unknown element types, kept as they are, are allowed wherever
 * elements are, so a valid document stays valid with a plugin missing.
 */
export function toJsonSchema(schema: DocumentSchema): JsonSchema {
  const $defs: Record<string, JsonSchema> = {
    'text': textLeaf(Object.keys(schema.marks)),
    'unknown-element': {
      type: 'object',
      description: 'An element whose plugin is missing here, kept as it is',
      required: ['type', 'class', 'children'],
      properties: { type: { type: 'string' }, class: { type: 'string' }, children: { type: 'array' } }
    }
  }

  for (const element of Object.values(schema.elements)) {
    $defs[element.type] = elementSchema(schema, element)
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'array',
    items: { anyOf: [...schema.topLevel.map(ref), ref('unknown-element')] },
    $defs
  }
}

function elementSchema(schema: DocumentSchema, element: ElementTypeSchema): JsonSchema {
  const properties: Record<string, JsonValue> = {
    id: { type: 'string' },
    type: { const: element.type },
    class: { const: element.class },
    children: childrenSchema(schema, element)
  }

  const declared = element.properties
  if (declared) {
    properties.properties = {
      type: 'object',
      properties: Object.fromEntries(Object.entries(declared).map(([name, property]) => [name, {
        type: property.type,
        ...(property.description ? { description: property.description } : {}),
        ...(property.enum ? { enum: property.enum } : {})
      }])),
      required: Object.entries(declared).filter(([, property]) => property.required).map(([name]) => name)
    }
  } else {
    properties.properties = { type: 'object' }
  }

  const required = ['type', 'class', 'children']
  if (element.class !== 'text') {
    required.push('id')
  }
  if (declared && Object.values(declared).some((property) => property.required)) {
    required.push('properties')
  }

  return {
    type: 'object',
    ...(element.description ? { description: element.description } : {}),
    required,
    properties
  }
}

function childrenSchema(schema: DocumentSchema, element: ElementTypeSchema): JsonSchema {
  if (element.class === 'void') {
    return { type: 'array', items: ref('text'), minItems: 1, maxItems: 1 }
  }
  if (!element.children?.length && (element.class === 'text' || element.class === 'inline')) {
    const inlines = element.class === 'text' ? element.inlines.map(ref) : []
    return { type: 'array', minItems: 1, items: { anyOf: [ref('text'), ...inlines, ref('unknown-element')] } }
  }

  const children = element.children?.map((child) => child.type)
    ?? Object.keys(schema.elements).filter((type) => schema.topLevel.includes(type))
  return { type: 'array', minItems: 1, items: { anyOf: [...children.map(ref), ref('unknown-element')] } }
}

function textLeaf(marks: string[]): JsonSchema {
  return {
    type: 'object',
    description: 'Text, with each mark it carries set to true',
    required: ['text'],
    properties: {
      text: { type: 'string' },
      ...Object.fromEntries(marks.map((mark) => [mark, { type: 'boolean' }]))
    }
  }
}

function ref(type: string): JsonSchema {
  return { $ref: `#/$defs/${type.replace(/~/g, '~0').replace(/\//g, '~1')}` }
}
