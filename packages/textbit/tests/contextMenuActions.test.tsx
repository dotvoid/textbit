import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useSlateStatic } from 'slate-react'
import { Editor, Transforms, type Descendant } from 'slate'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { ContextMenu } from '../lib/components/ContextMenu'
import { Text } from '../lib/plugins/Text'
import type { Plugin } from '../lib/types'
import type { ContextMenuMode } from '../lib/hooks/useContextMenu'

const content: Descendant[] = [
  { id: 'a', type: 'base/text', class: 'text', properties: {}, children: [{ text: 'Hello' }] },
  { id: 'b', type: 'test/note', class: 'text', properties: {}, children: [{ text: 'Note' }] }
]

const inNote = (element: { type: string }): [boolean, boolean, boolean] =>
  [element.type === 'test/note', true, false]

function plugins(handlers: { stamp: () => void, erase: () => void }): Plugin[] {
  return [
    Text(),
    {
      class: 'text',
      name: 'test/note',
      element: { class: 'text' },
      actions: [
        { name: 'stamp', title: 'Stamp', contextMenu: true, visibility: inNote, handler: handlers.stamp },
        {
          name: 'erase',
          title: 'Erase',
          contextMenu: true,
          visibility: (element) => [element.type === 'test/note', false, false],
          handler: handlers.erase
        },
        // Visible in menus, but not offered in the context menu
        { name: 'block-menu-only', title: 'Block menu only', visibility: inNote, handler: () => {} }
      ]
    },
    {
      class: 'text',
      name: 'test/everywhere',
      actions: [{
        name: 'shout',
        contextMenu: true,
        visibility: () => [true, true, false],
        handler: () => {}
      }]
    }
  ]
}

function setup({ hostMenu = true, mode }: { hostMenu?: boolean, mode?: ContextMenuMode } = {}) {
  const handlers = { stamp: vi.fn(), erase: vi.fn() }
  let editor: Editor | undefined
  function Capture() {
    editor = useSlateStatic()
    return null
  }
  const result = render(
    <TextbitRoot value={content} onChange={() => {}} plugins={plugins(handlers)}>
      <TextbitEditable contextMenu={mode} aria-label='Text'>
        <Capture />
        {hostMenu && (
          <ContextMenu.Root aria-label='Editor'>
            <ContextMenu.Group>
              <ContextMenu.Item>Host item</ContextMenu.Item>
            </ContextMenu.Group>
          </ContextMenu.Root>
        )}
      </TextbitEditable>
    </TextbitRoot>
  )
  const editable = result.container.querySelector('[data-slate-editor]') as HTMLElement

  // The Menu key fires contextmenu on the editor itself and uses the caret
  const rightClickAt = (path: number[]) => {
    act(() => Transforms.select(editor!, Editor.start(editor!, path)))
    act(() => {
      fireEvent.contextMenu(editable, { clientX: 0, clientY: 0 })
    })
  }
  const openAt = async (path: number[]) => {
    rightClickAt(path)
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeNull())
    return screen.getByRole('menu')
  }

  return { ...handlers, editor: editor!, openAt, rightClickAt }
}

const labels = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map((i) => i.textContent)

// jsdom has no requestAnimationFrame-driven layout; run frames right away
beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0))
})
afterAll(() => {
  vi.unstubAllGlobals()
})

describe('plugin actions in the context menu', () => {
  test('come before the host\'s items, those visible where it opened, a group per plugin', async () => {
    const { openAt } = setup({ mode: 'always' })

    const menu = await openAt([1])

    const groups = within(menu).getAllByRole('group')
    expect(groups.map((g) => within(g).getAllByRole('menuitem').map((i) => i.textContent))).toEqual([
      ['Stamp', 'Erase'],
      ['Shout'],
      ['Host item']
    ])
  })

  test('leave out what is not visible there', async () => {
    const { openAt } = setup({ mode: 'always' })

    const menu = await openAt([0])

    expect(labels(menu)).toEqual(['Shout', 'Host item'])
  })

  test('open the menu even in spelling mode, where a plugin offers something', async () => {
    const { openAt } = setup()

    const menu = await openAt([1])

    expect(labels(menu)).toEqual(['Stamp', 'Erase', 'Shout', 'Host item'])
  })

  test('picking one runs the action and closes the menu', async () => {
    const { openAt, stamp } = setup()
    const menu = await openAt([1])

    act(() => {
      fireEvent.mouseDown(within(menu).getByText('Stamp'))
    })

    expect(stamp).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  test('one that is not enabled is shown disabled and does nothing', async () => {
    const { openAt, erase } = setup()
    const menu = await openAt([1])
    const item = within(menu).getByText('Erase')

    expect(item.getAttribute('aria-disabled')).toBe('true')
    act(() => {
      fireEvent.mouseDown(item)
    })

    expect(erase).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeNull()
  })
})

describe('the built-in context menu, without one from the host', () => {
  test('shows the plugins\' actions', async () => {
    const { openAt } = setup({ hostMenu: false })

    const menu = await openAt([1])

    expect(labels(menu)).toEqual(['Stamp', 'Erase', 'Shout'])
  })

  test('stays away where no plugin offers anything', async () => {
    const plugins = [Text()]
    const { container } = render(
      <TextbitRoot value={content.slice(0, 1)} onChange={() => {}} plugins={plugins}>
        <TextbitEditable contextMenu='always' aria-label='Text' />
      </TextbitRoot>
    )

    act(() => {
      fireEvent.contextMenu(container.querySelector('[data-slate-editor]')!, { clientX: 0, clientY: 0 })
    })
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)))

    expect(screen.queryByRole('menu')).toBeNull()
  })

  test('gives way to the host\'s menu', async () => {
    const { openAt } = setup()

    await openAt([1])

    expect(screen.getAllByRole('menu')).toHaveLength(1)
  })
})
