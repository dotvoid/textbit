import { describe, test, expect, vi, beforeEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { Transforms, type Descendant, type Editor } from 'slate'
import { useSlateStatic } from 'slate-react'
import { scrollSelectionIntoView } from '../lib/components/TextbitEditable/scrollSelectionIntoView'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { Text } from '../lib/components/core/Text'
import type { PluginDefinition } from '../lib/types'

const defaultScroll = vi.hoisted(() => vi.fn())
vi.mock('slate-react', async (importOriginal) => ({
  ...await importOriginal<typeof import('slate-react')>(),
  defaultScrollSelectionIntoView: defaultScroll
}))

// A block with a void child, like an image
const Picture: PluginDefinition = {
  class: 'block',
  name: 'test/picture',
  componentEntry: {
    class: 'block',
    component: ({ children }) => <figure>{children}</figure>,
    children: [{
      type: 'content',
      class: 'void',
      component: ({ children }) => <><div contentEditable={false}>picture</div>{children}</>
    }]
  }
}

const content: Descendant[] = [
  { id: 'p', type: 'base/text', class: 'text', properties: {}, children: [{ text: 'Before' }] },
  {
    id: 'pic', type: 'test/picture', class: 'block', properties: {}, children: [
      { id: 'c', type: 'test/picture/content', class: 'void', children: [{ text: '' }] }
    ]
  }
] as Descendant[]

function setup() {
  let editor: Editor | undefined
  function Capture() {
    editor = useSlateStatic()
    return null
  }
  const result = render(
    <TextbitRoot value={content} onChange={() => {}} plugins={[Text(), Picture]}>
      <TextbitEditable><Capture /></TextbitEditable>
    </TextbitRoot>
  )
  return { editor: editor!, container: result.container }
}

const range = () => document.createRange()

describe('scrolling a new selection into view', () => {
  beforeEach(() => {
    defaultScroll.mockClear()
    Element.prototype.scrollIntoView = vi.fn()
  })

  test('a selection made with the pointer is not scrolled to', () => {
    const { editor } = setup()
    act(() => Transforms.select(editor, { path: [0, 0], offset: 2 }))

    scrollSelectionIntoView(editor, range(), true)

    expect(defaultScroll).not.toHaveBeenCalled()
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  test('text selected from the keyboard scrolls as slate-react does', () => {
    const { editor } = setup()
    act(() => Transforms.select(editor, { path: [0, 0], offset: 2 }))

    const domRange = range()
    scrollSelectionIntoView(editor, domRange, false)

    expect(defaultScroll).toHaveBeenCalledWith(editor, domRange)
  })

  test('on a void block, the block is scrolled into view only as far as needed', () => {
    const { editor, container } = setup()
    act(() => Transforms.select(editor, { path: [1, 0, 0], offset: 0 }))

    scrollSelectionIntoView(editor, range(), false)

    expect(defaultScroll).not.toHaveBeenCalled()
    const block = container.querySelector('[data-id="c"][data-slate-node="element"]')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts[0]).toBe(block)
  })
})
