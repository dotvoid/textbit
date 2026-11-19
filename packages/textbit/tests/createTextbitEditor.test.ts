// @vitest-environment node
import { describe, test, expect } from 'vitest'
import { Editor, Node, Transforms, type Descendant, type Element } from 'slate'
import * as Y from '@y/y'
import { createTextbitEditor } from '../lib/editor/createTextbitEditor'
import { fieldToValue, seedField, sharedOf } from '../lib/yjs'

function paragraph(id: string, text: string): Descendant {
  return { id, type: 'base/text', class: 'text', properties: {}, children: [{ text }] } as Descendant
}

describe('createTextbitEditor', () => {
  test('edits a document with core rules and no user interface', () => {
    const editor = createTextbitEditor({ value: [paragraph('a', 'Hello')] })

    Transforms.select(editor, Editor.end(editor, [0]))
    editor.insertBreak()
    editor.insertText('World')

    expect(editor.children).toHaveLength(2)
    expect(Editor.string(editor, [1])).toBe('World')
    const ids = editor.children.map((n) => (n as { id?: string }).id)
    expect(new Set(ids).size).toBe(2)
  })

  test('repairs a typeless top-level element when normalized', () => {
    const editor = createTextbitEditor({
      value: [{ id: 'x', class: 'text', properties: {}, children: [{ text: 'a' }] } as unknown as Descendant]
    })
    Editor.normalize(editor, { force: true })

    expect((editor.children[0] as { type?: string }).type).toBe('base/text')
  })

  test('uses the given language, or English', () => {
    expect(createTextbitEditor({ lang: 'sv' }).lang).toBe('sv')
  })

  test('collaborates through a shared document', () => {
    const shared = new Y.Doc().get('body')
    seedField(shared, [paragraph('a', 'Hello')] as Element[])

    const editor = createTextbitEditor({ shared })
    Transforms.insertText(editor, '!', { at: Editor.end(editor, [0]) })
    expect(Editor.string(editor, [0])).toBe('Hello!')

    expect(Node.string(fieldToValue(shared)[0])).toBe('Hello!')
    sharedOf(editor)?.release()
  })
})
