import type { TBDocumentSchema as DocumentSchema } from '@dotvoid/textbit/headless'

/**
 * Short names for the types and marks of a schema, as an agent reads and
 * writes them: `image` for `base/image`, `caption` for `base/image/caption`
 * inside an image, `bold` for `base/bold`. A name is the last part of the full
 * one, unless two would share it; then both keep their full name. Full names
 * are always understood too.
 */
export interface Names {
  /** The short name of a top-level or inline type, or a mark */
  short(type: string): string
  /** The short name of a child type within its parent */
  child(type: string): string
  /** The full type a name stands for at the top level or inline, if any */
  type(name: string): string | undefined
  /** The full type a name stands for as a child of `parent`, if any */
  childType(parent: string, name: string): string | undefined
  /** The full mark a name stands for, if any */
  mark(name: string): string | undefined
}

export function createNames(schema: DocumentSchema): Names {
  const elements = Object.values(schema.elements)
  const free = elements.filter((element) => !element.parent).map((element) => element.type)
  const marks = Object.keys(schema.marks)

  const freeNames = shorten(free)
  const markNames = shorten(marks)
  const freeTypes = invert(freeNames)
  const markTypes = invert(markNames)

  return {
    short: (type) => freeNames.get(type) ?? markNames.get(type) ?? type,
    child: (type) => {
      const parent = schema.elements[type]?.parent
      return parent ? type.slice(parent.length + 1) : freeNames.get(type) ?? type
    },
    type: (name) => freeTypes.get(name) ?? (free.includes(name) ? name : undefined),
    childType: (parent, name) => {
      const children = schema.elements[parent]?.children?.map((child) => child.type) ?? []
      return children.find((type) => type === name || type === `${parent}/${name}`)
    },
    mark: (name) => markTypes.get(name) ?? (marks.includes(name) ? name : undefined)
  }
}

/** The last part of each name, or the whole name where two would collide */
function shorten(names: string[]): Map<string, string> {
  const last = (name: string) => name.slice(name.lastIndexOf('/') + 1)
  const counts = new Map<string, number>()
  for (const name of names) {
    counts.set(last(name), (counts.get(last(name)) ?? 0) + 1)
  }
  return new Map(names.map((name) => [name, counts.get(last(name)) === 1 ? last(name) : name]))
}

function invert(map: Map<string, string>): Map<string, string> {
  return new Map([...map].map(([key, value]) => [value, key]))
}
