import { describe, test, expect, vi, beforeAll } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { Editor, Node, Transforms, type Descendant, type Element, type Point } from 'slate'
import { useSlateStatic } from 'slate-react'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { Text } from '../lib/plugins/Text'
import { prepareBlockAwarePaste } from '../lib/utils/blockAwarePaste'
import { TEXTBIT_TYPES_FORMAT, clipboardFragment } from '../lib/utils/clipboard'
import type { ComponentProps, Plugin } from '../lib/types'
import { Bold } from './_leafs'

// slate-react only handles events on editable targets, checked with
// isContentEditable, which jsdom does not implement
Object.defineProperty(HTMLElement.prototype, 'isContentEditable', {
  configurable: true,
  get(this: HTMLElement) {
    return this.closest('[contenteditable]')?.getAttribute('contenteditable') === 'true'
  }
})

// The shared setup stubs window.getSelection; copying needs jsdom's own
beforeAll(() => {
  window.getSelection = () => document.getSelection()
})

const Box = ({ children }: ComponentProps) => <div>{children}</div>

const Image: Plugin = {
  class: 'block',
  name: 'test/image',
  element: {
    class: 'block',
    children: [
      { type: 'image', class: 'void' },
      { type: 'caption', class: 'text' },
      { type: 'byline', class: 'text' }
    ]
  },
  view: {
    components: {
      'test/image': { component: Box },
      'test/image/image': {
        component: ({ children }) => <><div contentEditable={false}><img alt='' data-testid='img' /></div>{children}</>
      },
      'test/image/caption': { component: Box },
      'test/image/byline': { component: Box }
    }
  }
}

const onHeaderButton = vi.fn()
const Factbox: Plugin = {
  class: 'block',
  name: 'test/factbox',
  element: {
    class: 'block',
    children: [
      { type: 'title', class: 'text' },
      { type: 'body', class: 'text' }
    ]
  },
  view: {
    components: {
      'test/factbox': {
        component: ({ children }) => (
          <div>
            <div contentEditable={false} data-testid='factbox-header' onMouseDown={(e) => e.stopPropagation()}>
              Factbox <button type='button' onClick={onHeaderButton}>Collapse</button>
            </div>
            {children}
          </div>
        )
      },
      'test/factbox/title': { component: Box },
      'test/factbox/body': { component: Box }
    }
  }
}

const Link: Plugin = {
  class: 'inline',
  name: 'test/link',
  element: { class: 'inline' },
  view: {
    components: {
      'test/link': { component: ({ children }) => <a href='#'>{children}</a> }
    }
  }
}

const ALL = [Text(), Bold(), Image, Factbox, Link]

// Every type the full editor registers, children included, as a copy lists them
const ALL_TYPES = ['base/text', 'base/bold', 'test/image', 'test/image/image', 'test/image/caption', 'test/image/byline', 'test/factbox', 'test/factbox/title', 'test/factbox/body', 'test/link']

const p = (id: string, text: string): Descendant => ({ id, type: 'base/text', class: 'text', properties: {}, children: [{ text }] } as Descendant)
const image = (caption: Descendant[] = [{ text: 'A caption here' }]): Descendant => ({
  id: 'img', type: 'test/image', class: 'block', properties: { src: 'x.png' }, children: [
    { id: 'img-v', type: 'test/image/image', class: 'void', children: [{ text: '' }] },
    { id: 'img-c', type: 'test/image/caption', class: 'text', children: caption },
    { id: 'img-b', type: 'test/image/byline', class: 'text', children: [{ text: 'By Ann' }] }
  ]
} as Descendant)
const factbox = (title: Descendant[] = [{ text: 'Facts' }]): Descendant => ({
  id: 'fb', type: 'test/factbox', class: 'block', properties: { kind: 'info' }, children: [
    { id: 'fb-t', type: 'test/factbox/title', class: 'text', children: title },
    { id: 'fb-b', type: 'test/factbox/body', class: 'text', children: [{ text: 'Body text' }] }
  ]
} as Descendant)

const article = (): Descendant[] => [
  p('p0', 'Before image'), image(), p('p2', 'After one'), p('p3', 'After two'), factbox()
]

function setup(options: { plugins?: Plugin[], value?: Descendant[], readOnly?: boolean, extra?: React.ReactNode } = {}) {
  let editor: Editor | undefined
  function Capture() {
    editor = useSlateStatic()
    return null
  }
  const result = render(
    <TextbitRoot value={options.value ?? article()} onChange={() => {}} plugins={options.plugins ?? ALL} readOnly={options.readOnly}>
      <TextbitEditable><Capture />{options.extra}</TextbitEditable>
    </TextbitRoot>
  )
  return { editor: editor!, ...result }
}

/** A clipboard as the browser hands it over */
function clipboard() {
  const data = new Map<string, string>()
  return {
    data,
    transfer: {
      get types() { return [...data.keys()] },
      setData: (format: string, value: string) => { data.set(format, value) },
      getData: (format: string) => data.get(format) ?? '',
      items: [],
      files: []
    } as unknown as DataTransfer
  }
}

/** A clipboard holding a Slate fragment, and optionally the source types */
function payload(fragment: Descendant[], sourceTypes?: string[]) {
  const { data, transfer } = clipboard()
  data.set('application/x-slate-fragment', window.btoa(encodeURIComponent(JSON.stringify(fragment))))
  data.set('text/plain', fragment.map((n) => Node.string(n)).join('\n'))
  if (sourceTypes) {
    data.set(TEXTBIT_TYPES_FORMAT, JSON.stringify(sourceTypes))
  }
  return transfer
}

const caption = (offset: number): Point => ({ path: [1, 1, 0], offset })
const byline = (offset: number): Point => ({ path: [1, 2, 0], offset })

function copied(editor: Editor, anchor: Point, focus: Point) {
  act(() => Transforms.select(editor, { anchor, focus }))
  return clipboardFragment(editor)
}

const types = (nodes: Descendant[]) => nodes.map((n) => (n as Element).type)
const texts = (nodes: Descendant[]) => nodes.map((n) => Node.string(n))

describe('copying part of an object carries only its text', () => {
  test('inside one caption: one paragraph', () => {
    const { editor } = setup()
    const fragment = copied(editor, caption(2), caption(9))
    expect(types(fragment)).toEqual(['base/text'])
    expect(texts(fragment)).toEqual(['caption'])
  })

  test('and it pastes inline at the caret', () => {
    const { editor } = setup()
    const fragment = copied(editor, caption(2), caption(9))
    const target = setup({ value: [p('t', 'Hello')] }).editor
    act(() => Transforms.select(target, { path: [0, 0], offset: 3 }))
    act(() => target.insertData(payload(fragment, ALL_TYPES)))
    expect(texts(target.children)).toEqual(['Helcaptionlo'])
  })

  test('mid caption into the byline: caption text, then byline text', () => {
    const { editor } = setup()
    expect(texts(copied(editor, caption(2), byline(3)))).toEqual(['caption here', 'By '])
  })

  test('mid paragraph before an image into its caption: no image, no empty byline', () => {
    const { editor } = setup()
    const fragment = copied(editor, { path: [0, 0], offset: 7 }, caption(9))
    expect(types(fragment)).toEqual(['base/text', 'base/text'])
    expect(texts(fragment)).toEqual(['image', 'A caption'])
  })

  test('mid caption into the paragraphs after the image', () => {
    const { editor } = setup()
    // The selection runs through the byline too, so its text comes along
    expect(texts(copied(editor, caption(2), { path: [3, 0], offset: 9 }))).toEqual(['caption here', 'By Ann', 'After one', 'After two'])
  })

  test('ending exactly at the start of the caption: only the paragraph text', () => {
    const { editor } = setup()
    const fragment = copied(editor, { path: [0, 0], offset: 7 }, caption(0))
    expect(types(fragment)).toEqual(['base/text'])
    expect(texts(fragment)).toEqual(['image'])
  })

  test('a backward selection gives the same', () => {
    const { editor } = setup()
    expect(texts(copied(editor, byline(3), caption(2)))).toEqual(['caption here', 'By '])
  })

  test('bold text and a link keep both where the link plugin is registered', () => {
    const { editor } = setup({ value: [p('p0', 'Before'), image([{ text: 'A ' }, { text: 'bold', 'base/bold': true } as Descendant, { text: ' and ' }, { id: 'l', type: 'test/link', class: 'inline', children: [{ text: 'link' }] } as Descendant, { text: ' end' }])] })
    const fragment = copied(editor, Editor.start(editor, [1, 1]), Editor.end(editor, [1, 1]))

    const withLink = setup({ value: [p('t', '')] }).editor
    act(() => Transforms.select(withLink, { path: [0, 0], offset: 0 }))
    act(() => withLink.insertData(payload(fragment, ALL_TYPES)))
    const pasted = withLink.children[0] as Element
    expect(pasted.children.some((c) => (c as Element).type === 'test/link')).toBe(true)
    expect(pasted.children.some((c) => 'base/bold' in c)).toBe(true)

    const without = setup({ plugins: [Text(), Bold()], value: [p('t', '')] }).editor
    act(() => Transforms.select(without, { path: [0, 0], offset: 0 }))
    act(() => without.insertData(payload(fragment, ALL_TYPES)))
    const plain = without.children[0] as Element
    expect(Node.string(plain)).toBe('A bold and link end')
    expect(plain.children.some((c) => 'base/bold' in c)).toBe(true)
    expect(plain.children.every((c) => !('type' in c))).toBe(true)
  })

  test('a list of items in the object: a paragraph per item, never items in a paragraph', () => {
    const Notes: Plugin = {
      class: 'block',
      name: 'test/notes',
      element: {
        class: 'block',
        children: [
          { type: 'title', class: 'text' },
          { type: 'list', class: 'text', children: [{ type: 'item', class: 'text' }] }
        ]
      },
      view: {
        components: {
          'test/notes': { component: Box },
          'test/notes/title': { component: Box },
          'test/notes/list': { component: Box },
          'test/notes/list/item': { component: Box }
        }
      }
    }
    const item = (id: string, text: string) => ({ id, type: 'test/notes/list/item', class: 'text', children: [{ text }] })
    const notes = {
      id: 'n', type: 'test/notes', class: 'block', properties: {}, children: [
        { id: 'n-t', type: 'test/notes/title', class: 'text', children: [{ text: 'Title' }] },
        { id: 'n-l', type: 'test/notes/list', class: 'text', children: [item('i1', 'One'), item('i2', 'Two')] }
      ]
    } as Descendant
    const { editor } = setup({ plugins: [Text(), Notes], value: [p('p0', 'Before'), notes] })

    const fragment = copied(editor, { path: [1, 0, 0], offset: 2 }, { path: [1, 1, 1, 0], offset: 2 })
    expect(types(fragment)).toEqual(['base/text', 'base/text', 'base/text'])
    expect(texts(fragment)).toEqual(['tle', 'One', 'Tw'])
    expect(fragment.every((n) => (n as Element).children.every((c) => !('type' in c)))).toBe(true)
  })
})

describe('copying a whole object carries the object', () => {
  test('from before an image to the end of its byline', () => {
    const { editor } = setup()
    const fragment = copied(editor, { path: [0, 0], offset: 12 }, byline(6))
    expect(fragment.at(-1)).toEqual(editor.children[1])
  })

  test('a whole factbox', () => {
    const { editor } = setup()
    expect(copied(editor, Editor.start(editor, [4]), Editor.end(editor, [4]))).toEqual([editor.children[4]])
  })

  test('a collapsed selection in the image void copies the whole image', () => {
    const { editor } = setup()
    expect(copied(editor, { path: [1, 0, 0], offset: 0 }, { path: [1, 0, 0], offset: 0 })).toEqual([editor.children[1]])
  })

  test('the clipboard gets the fragment, the types, and the plain text', () => {
    const { editor } = setup()
    act(() => Transforms.select(editor, { anchor: caption(2), focus: caption(9) }))
    const { transfer, data } = clipboard()
    act(() => editor.setFragmentData(transfer))

    const fragment = JSON.parse(decodeURIComponent(window.atob(data.get('application/x-slate-fragment')!)))
    expect(texts(fragment)).toEqual(['caption'])
    expect(JSON.parse(data.get(TEXTBIT_TYPES_FORMAT)!)).toEqual(expect.arrayContaining(['test/image', 'test/image/caption', 'base/text']))
    expect(data.get('text/plain')).toBe('caption')
  })
})

describe('pasting objects the editor cannot render', () => {
  const noFactbox = [Text(), Bold(), Image, Link]

  test('known where it was copied, unknown here: paragraphs', () => {
    const { editor } = setup({ plugins: noFactbox, value: [p('t', '')] })
    act(() => Transforms.select(editor, { path: [0, 0], offset: 0 }))
    act(() => editor.insertData(payload([factbox()], ['base/text', 'test/factbox', 'test/factbox/title', 'test/factbox/body'])))
    expect(types(editor.children)).toEqual(['base/text', 'base/text'])
    expect(texts(editor.children)).toEqual(['Facts', 'Body text'])
  })

  test('unknown where it was copied too: kept as it is', () => {
    const { editor } = setup({ plugins: noFactbox, value: [p('t', 'x')] })
    act(() => Transforms.select(editor, { path: [0, 0], offset: 1 }))
    act(() => editor.insertData(payload([factbox()], ['base/text'])))
    const kept = editor.children.find((n) => (n as Element).type === 'test/factbox') as Element
    expect(kept.children).toEqual((factbox() as Element).children)
  })

  test('empty text fields add nothing', () => {
    const { editor } = setup({ plugins: [Text()], value: [p('t', 'Hello')] })
    act(() => Transforms.select(editor, Editor.end(editor, [0])))
    act(() => editor.insertData(payload([image([{ text: '' }]), factbox([{ text: '' }])], ALL_TYPES)))
    // The image's caption is empty, its byline is not; the factbox title is empty
    expect(texts(editor.children)).toEqual(['HelloBy Ann', 'Body text'])
  })

  test('no source types, as from an older version or another app: converted', () => {
    const { editor } = setup({ plugins: noFactbox, value: [p('t', '')] })
    act(() => Transforms.select(editor, { path: [0, 0], offset: 0 }))
    act(() => editor.insertData(payload([factbox()])))
    expect(texts(editor.children)).toEqual(['Facts', 'Body text'])
  })

  test('an unregistered inline inside an unregistered title keeps its text', () => {
    const { editor } = setup({ plugins: noFactbox, value: [p('t', '')] })
    act(() => Transforms.select(editor, { path: [0, 0], offset: 0 }))
    const title = [{ text: 'Facts by ' }, { id: 'm', type: 'acme/mention', class: 'inline', children: [{ text: '@ann' }] }, { text: '' }] as Descendant[]
    act(() => editor.insertData(payload([factbox(title)])))
    expect(texts(editor.children)[0]).toBe('Facts by @ann')
  })

  test('cut and paste of an unknown object within one editor: unchanged', () => {
    const value = [p('p0', 'One'), factbox(), p('p2', 'Two')]
    const { editor } = setup({ plugins: noFactbox, value })
    const before = JSON.parse(JSON.stringify(editor.children[1]))

    act(() => Transforms.select(editor, { path: [1, 0, 0], offset: 0 }))
    const { transfer } = clipboard()
    act(() => editor.setFragmentData(transfer))
    act(() => Transforms.removeNodes(editor, { at: [1] }))
    act(() => Transforms.select(editor, Editor.end(editor, [1])))
    act(() => editor.insertData(transfer))

    const pasted = editor.children.find((n) => (n as Element).type === 'test/factbox')
    expect(pasted).toMatchObject({ type: before.type, properties: before.properties, children: before.children })
  })

  test('a paste over a block selection that converts to nothing leaves the blocks', () => {
    const { editor } = setup({ plugins: noFactbox })
    const before = JSON.stringify(editor.children)
    const video = { id: 'v', type: 'test/video', class: 'void', children: [{ text: '' }] } as Descendant
    let result: string | undefined
    act(() => {
      result = prepareBlockAwarePaste(editor, payload([video], ['test/video']), null, { anchorIndex: 1, focusIndex: 1 }, new Set(noFactbox.map((x) => x.name)))
    })
    expect(result).toBe('empty')
    expect(JSON.stringify(editor.children)).toBe(before)
  })
})

describe('clicking an object selects all of it', () => {
  const blocksSelected = (container: HTMLElement) => [...container.querySelectorAll('[data-block-selected]')].map((el) => el.getAttribute('data-id'))

  test('a click on the image selects the image block, and a copy carries it in full', () => {
    const { editor, container, getByTestId } = setup()
    act(() => { fireEvent.click(getByTestId('img')) })
    expect(blocksSelected(container)).toEqual(['img'])
    expect(clipboardFragment(editor)).toEqual([editor.children[1]])
  })

  test('a click on a factbox header selects the factbox', () => {
    const { editor, container, getByTestId } = setup()
    act(() => { fireEvent.click(getByTestId('factbox-header')) })
    expect(blocksSelected(container)).toEqual(['fb'])
    expect(clipboardFragment(editor)).toEqual([editor.children[4]])
  })

  test('a click in a caption or a factbox body selects nothing', () => {
    const { container } = setup()
    const captionText = container.querySelector('[data-id="img-c"] [data-slate-string]')!
    const bodyText = container.querySelector('[data-id="fb-b"] [data-slate-string]')!
    act(() => { fireEvent.click(captionText) })
    act(() => { fireEvent.click(bodyText) })
    expect(blocksSelected(container)).toEqual([])
  })

  // The browser fires the click on what holds both ends of the drag
  test('a drag from a factbox title into its body selects nothing', () => {
    const { container } = setup()
    const title = container.querySelector('[data-id="fb-t"] [data-slate-string]')!
    const body = container.querySelector('[data-id="fb-b"]')!
    const holder = body.parentElement!
    expect(holder.contains(title)).toBe(true)
    act(() => {
      fireEvent.mouseDown(title, { clientX: 10, clientY: 10 })
      fireEvent.click(holder, { clientX: 60, clientY: 30 })
    })
    expect(blocksSelected(container)).toEqual([])
  })

  test('a drag that starts on a header which stops mousedown selects nothing', () => {
    const { container, getByTestId } = setup()
    const holder = container.querySelector('[data-id="fb-b"]')!.parentElement!
    act(() => {
      fireEvent.mouseDown(getByTestId('factbox-header'), { clientX: 10, clientY: 10 })
      fireEvent.click(holder, { clientX: 10, clientY: 40 })
    })
    expect(blocksSelected(container)).toEqual([])
  })

  test('a click where the mouse moved a little still selects the factbox', () => {
    const { container, getByTestId } = setup()
    const header = getByTestId('factbox-header')
    act(() => {
      fireEvent.mouseDown(header, { clientX: 10, clientY: 10 })
      fireEvent.click(header, { clientX: 12, clientY: 13 })
    })
    expect(blocksSelected(container)).toEqual(['fb'])
  })

  test('a button in an object does what it does, and selects nothing', () => {
    onHeaderButton.mockClear()
    const { container, getByText } = setup()
    act(() => { fireEvent.click(getByText('Collapse')) })
    expect(onHeaderButton).toHaveBeenCalled()
    expect(blocksSelected(container)).toEqual([])
  })

  test('a click in a dialog an object opened, portalled out of the editor, selects nothing', () => {
    function Dialog() {
      return createPortal(<div data-testid='dialog'>Dialog</div>, document.body)
    }
    const { editor, container, getByTestId } = setup({ extra: <Dialog /> })
    act(() => Transforms.select(editor, { path: [0, 0], offset: 2 }))
    act(() => { fireEvent.click(getByTestId('dialog')) })
    expect(blocksSelected(container)).toEqual([])
    expect(editor.selection?.anchor).toEqual({ path: [0, 0], offset: 2 })
  })

  test('Shift+click extends the block selection', () => {
    const { container, getByTestId } = setup()
    act(() => { fireEvent.click(getByTestId('img')) })
    act(() => {
      fireEvent.mouseDown(getByTestId('factbox-header'), { shiftKey: true })
      fireEvent.click(getByTestId('factbox-header'), { shiftKey: true })
    })
    expect(blocksSelected(container)).toEqual(['img', 'p2', 'p3', 'fb'])
  })

  test('Escape leaves the block selection, to a caret after the block', () => {
    const { container, getByTestId } = setup()
    act(() => { fireEvent.click(getByTestId('img')) })
    act(() => { fireEvent.keyDown(container.querySelector('[data-slate-editor]')!, { key: 'Escape' }) })
    expect(blocksSelected(container)).toEqual([])
    expect(container.querySelector('[data-id="img"][data-slate-node="element"]')!.getAttribute('data-state')).toBe('after')
  })

  test('read-only: a click selects and a copy works, and Delete does nothing', () => {
    const { editor, container, getByTestId } = setup({ readOnly: true })
    const before = JSON.stringify(editor.children)
    act(() => { fireEvent.click(getByTestId('img')) })
    expect(blocksSelected(container)).toEqual(['img'])
    expect(clipboardFragment(editor)).toEqual([editor.children[1]])

    act(() => { fireEvent.keyDown(container.querySelector('[data-slate-editor]')!, { key: 'Delete' }) })
    act(() => { fireEvent.keyDown(container.querySelector('[data-slate-editor]')!, { key: 'x', ctrlKey: true }) })
    expect(JSON.stringify(editor.children)).toBe(before)
  })

  test('read-only: a paste over a clicked object changes nothing', () => {
    const { editor, container, getByTestId } = setup({ readOnly: true })
    const before = JSON.stringify(editor.children)
    act(() => { fireEvent.click(getByTestId('img')) })
    act(() => { fireEvent.paste(container.querySelector('[data-slate-editor]')!, { clipboardData: payload([p('x', 'Pasted')], ['base/text']) }) })
    expect(JSON.stringify(editor.children)).toBe(before)
  })

  test('read-only: an editing shortcut changes nothing', () => {
    const { editor, container } = setup({ readOnly: true })
    act(() => Transforms.select(editor, { anchor: { path: [0, 0], offset: 0 }, focus: { path: [0, 0], offset: 6 } }))
    act(() => { fireEvent.keyDown(container.querySelector('[data-slate-editor]')!, { key: 'b', ctrlKey: true, metaKey: true }) })
    expect((editor.children[0] as Element).children).toEqual([{ text: 'Before image' }])
  })
})

describe('the caret after pasting an object', () => {
  const stateOf = (container: HTMLElement, id: string) => container.querySelector(`[data-id="${id}"][data-slate-node="element"]`)!.getAttribute('data-state')
  const editable = (container: HTMLElement) => container.querySelector('[data-slate-editor]')!

  test('click, cut, paste elsewhere: a block caret after the pasted object', () => {
    const { editor, container, getByTestId } = setup()
    act(() => { fireEvent.click(getByTestId('img')) })
    const { transfer } = clipboard()
    act(() => editor.setFragmentData(transfer))
    act(() => { fireEvent.keyDown(editable(container), { key: 'Delete' }) })
    expect(types(editor.children)).not.toContain('test/image')

    // The caret at the start of "After two", then paste
    act(() => Transforms.select(editor, Editor.start(editor, [2])))
    act(() => editor.insertData(transfer))

    expect(types(editor.children)).toEqual(['base/text', 'base/text', 'test/image', 'base/text', 'test/factbox'])
    expect(stateOf(container, 'img')).toBe('after')
    expect(container.querySelectorAll('[data-block-selected]')).toHaveLength(0)
  })

  test('pasting over a block selection: a block caret after the pasted object', () => {
    const { container, getByTestId } = setup()
    act(() => { fireEvent.click(getByTestId('factbox-header')) })
    act(() => { fireEvent.paste(editable(container), { clipboardData: payload([image()], ALL_TYPES) }) })

    expect(container.querySelectorAll('[data-block-selected]')).toHaveLength(0)
    const pasted = [...container.querySelectorAll('[data-slate-editor] > div > [data-slate-node="element"]')].at(-1)!
    expect(pasted.getAttribute('data-type')).toBe('test/image')
    expect(pasted.getAttribute('data-state')).toBe('after')
  })
})

describe('an object whose plugin is missing', () => {
  const noFactbox = [Text(), Bold(), Image, Link]
  const unknownValue = () => [p('p0', 'One'), factbox([{ text: 'Facts ' }, { id: 'm', type: 'acme/mention', class: 'inline', children: [{ text: '@ann' }] }, { text: '' }]), p('p2', 'Two')]

  test('is left as it is when the document is loaded and normalised', () => {
    const value = unknownValue()
    const { editor } = setup({ plugins: noFactbox, value })
    act(() => Editor.normalize(editor, { force: true }))
    expect(editor.children[1]).toEqual(value[1])
  })

  test('shows its type and its text', () => {
    const { container } = setup({ plugins: noFactbox, value: unknownValue() })
    expect(container.querySelector('[data-tb="unknown-type"]')?.textContent).toBe('test/factbox')
    expect([...container.querySelectorAll('[data-tb="unknown-text"]')].map((e) => e.textContent)).toEqual(['Facts @ann', 'Body text'])
  })

  test('can be turned into text', () => {
    const { editor, getByText } = setup({ plugins: noFactbox, value: unknownValue() })
    act(() => { fireEvent.click(getByText('Convert to text')) })
    expect(types(editor.children)).toEqual(['base/text', 'base/text', 'base/text', 'base/text'])
    expect(texts(editor.children)).toEqual(['One', 'Facts @ann', 'Body text', 'Two'])
  })

  test('can be removed', () => {
    const { editor, getByText } = setup({ plugins: noFactbox, value: unknownValue() })
    act(() => { fireEvent.click(getByText('Remove')) })
    expect(texts(editor.children)).toEqual(['One', 'Two'])
  })

  describe('the keyboard parks a block caret beside it, as beside any object', () => {
    const at = (point: (editor: Editor) => Point) => {
      const { editor, container } = setup({ plugins: noFactbox, value: unknownValue() })
      act(() => Transforms.select(editor, point(editor)))
      const factbox = () => container.querySelector('[data-id="fb"][data-slate-node="element"]')!
      return {
        press: (key: string) => act(() => { fireEvent.keyDown(container.querySelector('[data-slate-editor]')!, { key }) }),
        state: () => factbox().getAttribute('data-state'),
        caretDrawn: () => [...factbox().children].some((c) => (c.getAttribute('style') ?? '').includes('block-caret-blink'))
      }
    }

    test('ArrowDown from the paragraph above: before it, and the caret is drawn', () => {
      const { press, state, caretDrawn } = at((editor) => Editor.end(editor, [0]))
      press('ArrowDown')
      expect(state()).toBe('before')
      expect(caretDrawn()).toBe(true)
    })

    test('ArrowUp from the paragraph below: after it', () => {
      const { press, state } = at((editor) => Editor.start(editor, [2]))
      press('ArrowUp')
      expect(state()).toBe('after')
    })

    test('ArrowRight from the paragraph above: before it, then after it', () => {
      const { press, state } = at((editor) => Editor.end(editor, [0]))
      press('ArrowRight')
      expect(state()).toBe('before')
      press('ArrowRight')
      expect(state()).toBe('after')
    })
  })

  test('offers neither when read-only', () => {
    const { queryByText } = setup({ plugins: noFactbox, value: unknownValue(), readOnly: true })
    expect(queryByText('Convert to text')).toBeNull()
    expect(queryByText('Remove')).toBeNull()
  })

  test('is selected whole by a click, and a copy carries it whole', () => {
    const { editor, container } = setup({ plugins: noFactbox, value: unknownValue() })
    act(() => { fireEvent.click(container.querySelector('[data-tb="unknown-type"]')!) })
    expect([...container.querySelectorAll('[data-block-selected]')].map((el) => el.getAttribute('data-id'))).toEqual(['fb'])
    // Slate renders only a void's first text: the selection ends where it can be shown
    expect(editor.selection?.focus).toEqual(Editor.start(editor, [1]))
    expect(clipboardFragment(editor)).toEqual([editor.children[1]])
  })
})

describe('Tab and Escape around an object with controls', () => {
  const noFactbox = [Text(), Bold(), Image, Link]
  const value = () => [p('p0', 'One'), factbox(), p('p2', 'Two')]

  function page(options: { readOnly?: boolean, extra?: React.ReactNode } = {}) {
    let editor: Editor | undefined
    function Capture() {
      editor = useSlateStatic()
      return null
    }
    const result = render(
      <>
        <button type='button'>Before</button>
        <TextbitRoot value={value()} onChange={() => {}} plugins={noFactbox} readOnly={options.readOnly}>
          <TextbitEditable><Capture />{options.extra}</TextbitEditable>
        </TextbitRoot>
        <button type='button'>After</button>
      </>
    )
    const editable = result.container.querySelector('[data-slate-editor]') as HTMLElement
    const factboxEl = () => result.container.querySelector('[data-id="fb"][data-slate-node="element"]')!
    const press = (target: Element, key: string, shiftKey = false) => act(() => { fireEvent.keyDown(target, { key, shiftKey }) })
    return { editor: editor!, editable, ...result, state: () => factboxEl().getAttribute('data-state'), press }
  }

  const focused = () => document.activeElement?.textContent

  test('from the block caret before it, Tab reaches its first control', () => {
    const { editor, editable, press } = page()
    act(() => Transforms.select(editor, Editor.end(editor, [0])))
    press(editable, 'ArrowDown')
    press(editable, 'Tab')
    expect(focused()).toBe('Convert to text')
  })

  test('Tab on its last control: the block caret after it', () => {
    const { getByText, state, press } = page()
    getByText('Remove').focus()
    press(getByText('Remove'), 'Tab')
    expect(state()).toBe('after')
    expect(document.activeElement?.getAttribute('data-slate-editor')).toBe('true')
  })

  test('Shift+Tab on its first control: the block caret before it', () => {
    const { getByText, state, press } = page()
    getByText('Convert to text').focus()
    press(getByText('Convert to text'), 'Tab', true)
    expect(state()).toBe('before')
  })

  test('from the block caret after it, Tab leaves the editor and Shift+Tab reaches its last control', () => {
    const first = page()
    first.getByText('Remove').focus()
    first.press(first.getByText('Remove'), 'Tab')
    first.press(first.editable, 'Tab')
    expect(focused()).toBe('After')
    first.unmount()

    const second = page()
    second.getByText('Remove').focus()
    second.press(second.getByText('Remove'), 'Tab')
    second.press(second.editable, 'Tab', true)
    expect(focused()).toBe('Remove')
  })

  test('from the block caret before it, Shift+Tab leaves the editor backwards', () => {
    const { getByText, editable, press } = page()
    getByText('Convert to text').focus()
    press(getByText('Convert to text'), 'Tab', true)
    press(editable, 'Tab', true)
    expect(focused()).toBe('Before')
  })

  test('from ordinary text, Tab leaves the editor without stopping at any object', () => {
    const { editor, editable, press } = page()
    act(() => Transforms.select(editor, { path: [0, 0], offset: 1 }))
    press(editable, 'Tab')
    expect(focused()).toBe('After')
  })

  test('a selected object: Tab reaches its first control, Shift+Tab its last', () => {
    const forward = page()
    act(() => { fireEvent.click(forward.container.querySelector('[data-tb="unknown-type"]')!) })
    forward.press(forward.editable, 'Tab')
    expect(focused()).toBe('Convert to text')
    forward.unmount()

    const back = page()
    act(() => { fireEvent.click(back.container.querySelector('[data-tb="unknown-type"]')!) })
    back.press(back.editable, 'Tab', true)
    expect(focused()).toBe('Remove')
  })

  test('Escape in a control selects the object', () => {
    const { container, getByText, press } = page()
    getByText('Remove').focus()
    press(getByText('Remove'), 'Escape')
    expect([...container.querySelectorAll('[data-block-selected]')].map((e) => e.getAttribute('data-id'))).toEqual(['fb'])
    expect(document.activeElement?.getAttribute('data-slate-editor')).toBe('true')
  })

  test('Escape a control uses itself is left to it', () => {
    const { container, getByText, press } = page()
    getByText('Remove').addEventListener('keydown', (e) => e.preventDefault())
    press(getByText('Remove'), 'Escape')
    expect(container.querySelectorAll('[data-block-selected]')).toHaveLength(0)
  })

  test('keys in a dialog an object opened elsewhere are left alone', () => {
    function Dialog() {
      return createPortal(<button type='button'>In dialog</button>, document.body)
    }
    const { container, getByText, press } = page({ extra: <Dialog /> })
    getByText('In dialog').focus()
    press(getByText('In dialog'), 'Escape')
    press(getByText('In dialog'), 'Tab')
    expect(container.querySelectorAll('[data-block-selected]')).toHaveLength(0)
    expect(focused()).toBe('In dialog')
  })

  test('read-only: Tab from the text leaves the editor', () => {
    const { editor, editable, press } = page({ readOnly: true })
    act(() => Transforms.select(editor, { path: [0, 0], offset: 1 }))
    press(editable, 'Tab')
    expect(focused()).toBe('After')
  })
})

