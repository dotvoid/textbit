import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import * as Y from '@y/y'
import { Awareness } from '@y/protocols/awareness'
import { useSlateStatic } from 'slate-react'
import { Transforms, type Editor, type Element } from 'slate'
import { fieldToValue, seedField, sharedOf, type TBSharedField } from '../../lib/yjs'
import { TextbitRoot } from '../../lib/components/TextbitRoot'
import { TextbitEditable } from '../../lib/components/TextbitEditable/TextbitEditable'
import { basicEditorContent } from '../_fixtures'

describe('a shared editor in a component that renders again', () => {
  test('keeps its binding, and with it its undo, when the cursor is written inline', () => {
    const doc = new Y.Doc()
    const field = doc.get('body')
    seedField(field, basicEditorContent as Element[])
    const awareness = new Awareness(doc)
    const seen: Array<TBSharedField | undefined> = []
    const Probe = () => {
      const editor: Editor = useSlateStatic()
      seen.push(sharedOf(editor))
      return null
    }
    const page = (name: string) => (
      <TextbitRoot value={field} awareness={awareness} cursor={{ data: { name, color: 'red' } }}>
        <TextbitEditable />
        <Probe />
      </TextbitRoot>
    )
    const { rerender } = render(page('Ann'))
    rerender(page('Ann'))
    rerender(page('Ann'))
    const bindings = new Set(seen.filter(Boolean))
    expect(bindings.size).toBe(1)
  })
})

describe('a shared editor in Textbit.Root', () => {
  test('writes what its plugins make of an operation, as a headless one does', () => {
    const doc = new Y.Doc()
    const field = doc.get('body')
    seedField(field, basicEditorContent as Element[])
    let editor: Editor | undefined
    const Probe = () => {
      editor = useSlateStatic()
      return null
    }
    render(
      <TextbitRoot value={field}>
        <TextbitEditable />
        <Probe />
      </TextbitRoot>
    )
    // A split copies the block's id: the plugins give the new block one of its own
    Transforms.splitNodes(editor!, { at: { path: [0, 0], offset: 2 } })
    const ids = fieldToValue(field).map((block) => block.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(sharedOf(editor!)!.check()).toBe(true)
  })
})
