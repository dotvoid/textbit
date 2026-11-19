// Y.js behaviour we depend on or work around, so a new release candidate that
// changes it shows up here
import { describe, expect, it } from 'vitest'
import * as Y from '@y/y'

describe('Y.js 14 upstream', () => {
  // undoContentIds deletes text instead of restoring it when the set holds both a
  // deletion and the earlier undo of that deletion (see FINDINGS.md). Expected to
  // fail until fixed upstream; when it passes, the workaround can go.
  it.fails('restores a version after one of the later changes was itself undone', () => {
    const doc = new Y.Doc({ gc: false })
    const text = doc.get('text')
    const ids = () => Y.createContentIdsFromDoc(doc, true)
    text.insert(0, 'abc')
    const v1 = ids()
    text.delete(1, 1)
    Y.undoContentIds(doc, Y.excludeContentIds(ids(), v1))
    expect(text.toString()).toBe('abc')
    Y.undoContentIds(doc, Y.excludeContentIds(ids(), v1))
    expect(text.toString()).toBe('abc')
  })

  it('generates 53-bit client ids', () => {
    const ids = Array.from({ length: 50 }, () => new Y.Doc().clientID)
    expect(ids.some((id) => id > 2 ** 32)).toBe(true)
    expect(ids.every((id) => Number.isSafeInteger(id))).toBe(true)
  })
})
