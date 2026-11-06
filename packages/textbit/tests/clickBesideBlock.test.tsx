import { describe, test, expect, vi, afterEach } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import type { Descendant } from 'slate'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { Text } from '../lib/components/core/Text'
import type { PluginDefinition } from '../lib/types'

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

// jsdom has no layout: the paragraph at 0-40, the picture at 60-160, both
// from x 100 to 500, inside an editor surface from x 0 to 600
const boxes: Record<string, [number, number]> = { p: [0, 40], pic: [60, 160] }

function layout() {
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const id = this.matches('[data-slate-node="element"]') ? this.getAttribute('data-id') : null
    const [top, bottom] = boxes[id ?? ''] ?? [0, 0]
    const r = id && boxes[id] ? { top, bottom, left: 100, right: 500 } : { top: 0, bottom: 0, left: 0, right: 0 }
    return { ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => r } as DOMRect
  })
}

function setup() {
  const { container } = render(
    <TextbitRoot value={content} onChange={() => {}} plugins={[Text(), Picture]}>
      <button type='button'>Host button</button>
      <TextbitEditable />
    </TextbitRoot>
  )
  const root = container.querySelector('[data-tb="editor"]') as HTMLElement
  const picture = () => container.querySelector('[data-id="pic"][data-slate-node="element"]') as HTMLElement
  return { root, picture, button: container.querySelector('button')! }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a click in the editor surface beside a block', () => {
  test('right of it parks the caret after the block', () => {
    layout()
    const { root, picture } = setup()

    act(() => {
      fireEvent.mouseDown(root, { clientX: 560, clientY: 100 })
    })

    expect(picture().dataset.state).toBe('after')
  })

  test('left of it, in the gutter or padding, parks the caret before the block', () => {
    layout()
    const { root, picture } = setup()

    act(() => {
      fireEvent.mouseDown(root, { clientX: 20, clientY: 100 })
    })

    expect(picture().dataset.state).toBe('before')
  })

  test('on a control of its own, such as a button, does nothing', () => {
    layout()
    const { button, picture } = setup()

    act(() => {
      fireEvent.mouseDown(button, { clientX: 20, clientY: 100 })
    })

    expect(picture().dataset.state).not.toMatch(/before|after/)
  })

  test('beside a text block, does nothing', () => {
    layout()
    const { root, picture } = setup()

    act(() => {
      fireEvent.mouseDown(root, { clientX: 560, clientY: 20 })
    })

    expect(picture().dataset.state).not.toMatch(/before|after/)
  })
})
