/**
 * A short hash of a node or document: FNV-1a over its JSON with keys sorted,
 * so the same content hashes the same on every peer, however each ordered
 * the properties it got from Y.js. An empty `properties` counts as none, as a
 * shared document cannot tell them apart.
 */
export function hashNode(value: unknown): string {
  const text = canonical(value)
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(value).sort()
      .filter((key) => record[key] !== undefined && !(key === 'properties' && isEmptyObject(record[key])))
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function isEmptyObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0
}
