// @vitest-environment node
import { describe, test, expect } from 'vitest'
import { Editor, Node, Transforms, type Descendant } from 'slate'
import * as Y from 'yjs'
import { YjsEditor, slateNodesToInsertDelta, yTextToSlateElement } from '@slate-yjs/core'
import { createTextbitEditor } from '../lib/editor/createTextbitEditor'

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
    const doc = new Y.Doc()
    const shared = doc.get('content', Y.XmlText)
    shared.applyDelta(slateNodesToInsertDelta([paragraph('a', 'Hello')]))

    const editor = createTextbitEditor({ shared })
    YjsEditor.connect(editor as YjsEditor & Editor)
    Transforms.insertText(editor, '!', { at: Editor.end(editor, [0]) })
    expect(Editor.string(editor, [0])).toBe('Hello!')
    YjsEditor.flushLocalChanges(editor as YjsEditor & Editor)

    expect(Node.string(yTextToSlateElement(shared))).toBe('Hello!')
    YjsEditor.disconnect(editor as YjsEditor & Editor)
  })
})
