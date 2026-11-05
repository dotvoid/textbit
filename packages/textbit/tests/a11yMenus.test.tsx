import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSlateStatic } from 'slate-react'
import { Editor, Transforms, type Descendant } from 'slate'
import { useRef, useState } from 'react'
import axe from 'axe-core'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { ContextMenu } from '../lib/components/ContextMenu'
import { ContextTools } from '../lib/components/ContextTools'
import { ContentTools } from '../lib/components/ContentTools'
import { MenuContext, type MenuState } from '../lib/components/ContentTools/MenuContext'
import { usePluginRegistry } from '../lib/hooks/usePluginRegistry'
import { ariaKeyShortcuts, handleRovingKeys, MENU_ITEM } from '../lib/utils/menuKeyboard'

const content: Descendant[] = [
  { id: 'a', type: 'core/text', class: 'text', properties: {}, children: [{ text: 'Hello world' }] }
]

function renderEditor(children: React.ReactNode) {
  let editor: Editor | undefined
  function Capture() {
    editor = useSlateStatic()
    return null
  }
  const result = render(
    <TextbitRoot value={content} onChange={() => {}}>
      <TextbitEditable contextMenu='always' aria-label='Article text'>
        <Capture />
        {children}
      </TextbitEditable>
    </TextbitRoot>
  )
  const editable = result.container.querySelector('[data-slate-editor]') as HTMLElement
  return { editor: editor!, editable, ...result }
}

async function axeViolations(element: Element) {
  const results = await axe.run(element, {
    // jsdom has no layout, so contrast and size checks cannot run
    rules: { 'color-contrast': { enabled: false }, 'target-size': { enabled: false } }
  })
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

// jsdom has no requestAnimationFrame-driven layout; run frames right away
beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0))
})
afterAll(() => {
  vi.unstubAllGlobals()
})

describe('menu keyboard helpers', () => {
  function list(labels: Array<string | [string, { disabled?: boolean, hidden?: string }]>) {
    const { container } = render(
      <div role='menu'>
        {labels.map((l) => {
          const [label, opts] = typeof l === 'string' ? [l, {}] : l
          return (
            <a key={label} role='menuitem' tabIndex={-1} aria-disabled={opts.disabled || undefined}>
              {opts.hidden && <span aria-hidden='true'>{opts.hidden}</span>}
              {label}
            </a>
          )
        })}
      </div>
    )
    const menu = container.firstElementChild as HTMLElement
    const press = (key: string) => {
      const event = { key, preventDefault: vi.fn(), altKey: false, ctrlKey: false, metaKey: false } as unknown as React.KeyboardEvent
      return { handled: handleRovingKeys(event, menu, MENU_ITEM, 'vertical'), event }
    }
    const focused = () => document.activeElement?.textContent
    return { menu, press, focused }
  }

  test('arrows move and wrap, Home and End jump', () => {
    const { press, focused } = list(['One', 'Two', 'Three'])

    press('ArrowDown')
    expect(focused()).toBe('One')
    press('ArrowUp')
    expect(focused()).toBe('Three')
    press('ArrowDown')
    expect(focused()).toBe('One')
    press('End')
    expect(focused()).toBe('Three')
    press('Home')
    expect(focused()).toBe('One')
  })

  test('disabled items are skipped', () => {
    const { press, focused } = list(['One', ['Two', { disabled: true }], 'Three'])

    press('Home')
    press('ArrowDown')
    expect(focused()).toBe('Three')
  })

  test('a letter jumps to the next item it starts, ignoring hidden icons', () => {
    const { press, focused } = list([['Insert special character', { hidden: 'Ω' }], 'Text', 'Table'])

    press('i')
    expect(focused()).toBe('ΩInsert special character')
    press('t')
    expect(focused()).toBe('Text')
    press('t')
    expect(focused()).toBe('Table')
  })

  test('other keys are left alone', () => {
    const { press } = list(['One'])
    const { handled, event } = press('Enter')

    expect(handled).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  test.each([
    ['mod+shift+i', true, 'Meta+Shift+I'],
    ['mod+shift+i', false, 'Control+Shift+I'],
    ['mod+option+up', false, 'Control+Alt+ArrowUp'],
    ['ctrl+shift+space', false, 'Control+Shift+Space']
  ] as const)('%s on mac=%s is announced as %s', (hotkey, mac, expected) => {
    expect(ariaKeyShortcuts(hotkey, mac)).toBe(expected)
  })
})

describe('context menu', () => {
  function Menu({ onPick }: { onPick: (label: string) => void }) {
    return (
      <ContextMenu.Root aria-label='Editor'>
        <ContextMenu.Group>
          <ContextMenu.Item func={() => onPick('first')}>First</ContextMenu.Item>
          <ContextMenu.Item func={() => onPick('second')}>Second</ContextMenu.Item>
        </ContextMenu.Group>
      </ContextMenu.Root>
    )
  }

  async function openFromKeyboard() {
    const onPick = vi.fn()
    const setup = renderEditor(<Menu onPick={onPick} />)
    act(() => Transforms.select(setup.editor, { path: [0, 0], offset: 5 }))
    // The Menu key fires contextmenu on the editor itself, not on the text
    act(() => {
      fireEvent.contextMenu(setup.editable, { clientX: 0, clientY: 0 })
    })
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('menuitem'))
    return { ...setup, onPick }
  }

  test('opens from the keyboard with focus on its first item, and leaves the caret alone', async () => {
    const { editor } = await openFromKeyboard()

    expect(screen.getByRole('menu', { name: 'Editor' })).toBeTruthy()
    expect(document.activeElement?.textContent).toBe('First')
    expect(editor.selection?.anchor.offset).toBe(5)
  })

  test('arrows move between items and Enter picks one', async () => {
    const { onPick } = await openFromKeyboard()

    act(() => {
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    })
    expect(document.activeElement?.textContent).toBe('Second')

    act(() => {
      fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
    })
    expect(onPick).toHaveBeenCalledWith('second')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  test('Escape closes it without picking anything', async () => {
    const { onPick } = await openFromKeyboard()

    act(() => {
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    })

    expect(screen.queryByRole('menu')).toBeNull()
    expect(onPick).not.toHaveBeenCalled()
  })

  test('typing a letter no longer closes it', async () => {
    await openFromKeyboard()

    act(() => {
      fireEvent.keyDown(document.activeElement!, { key: 's' })
    })

    expect(screen.queryByRole('menu')).not.toBeNull()
    expect(document.activeElement?.textContent).toBe('Second')
  })

  test('has no accessibility violations', async () => {
    await openFromKeyboard()
    expect(await axeViolations(screen.getByRole('menu'))).toEqual([])
  })

  test('carries data-tb hooks for a stylesheet to target', async () => {
    await openFromKeyboard()
    const menu = screen.getByRole('menu')
    expect(menu.getAttribute('data-tb')).toBe('context-menu')
    expect(new Set([...menu.querySelectorAll('[data-tb]')].map((n) => n.getAttribute('data-tb')))).toEqual(new Set(['context-menu-group', 'context-menu-item']))
  })
})

describe('gutter menu', () => {
  function Harness({ onAction }: { onAction: () => void }) {
    const [isOpen, setOpen] = useState(false)
    const focusRef = useRef<'first' | 'last' | undefined>(undefined)
    const triggerRef = useRef<HTMLElement | null>(null)
    const { actions } = usePluginRegistry()
    const bold = actions.find((a) => a.name === 'core/bold/toggle-bold')!
    bold.handler = () => {
      onAction()
    }
    bold.visibility = () => [true, true, false]
    const italic = actions.find((a) => a.name === 'core/italic/toggle-italic')!
    italic.visibility = () => [true, true, false]
    const value: MenuState = {
      isOpen,
      setIsOpen: (open, focus = 'first') => {
        focusRef.current = open ? focus : undefined
        setOpen(open)
      },
      focusRef,
      triggerRef,
      triggerId: 'trigger',
      contentId: 'content'
    }

    return (
      <MenuContext.Provider value={value}>
        <ContentTools.Trigger>⋮</ContentTools.Trigger>
        <ContentTools.Content>
          <ContentTools.Group>
            <ContentTools.Item action='core/bold/toggle-bold'>
              <ContentTools.Icon />
              <ContentTools.Label />
              <ContentTools.Hotkey />
            </ContentTools.Item>
            <ContentTools.Item action='core/italic/toggle-italic'>
              <ContentTools.Label />
            </ContentTools.Item>
          </ContentTools.Group>
        </ContentTools.Content>
      </MenuContext.Provider>
    )
  }

  async function setup() {
    const onAction = vi.fn()
    const result = renderEditor(<Harness onAction={onAction} />)
    act(() => Transforms.select(result.editor, { path: [0, 0], offset: 2 }))
    await act(async () => {})
    const trigger = screen.getByRole('button', { name: '⋮' })
    return { ...result, trigger, onAction }
  }

  test('the trigger is a menu button in the tab order', async () => {
    const { trigger } = await setup()

    expect(trigger.tabIndex).toBe(0)
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  test('Enter opens it on the first item, ArrowUp on the last', async () => {
    const { trigger } = await setup()

    act(() => {
      fireEvent.keyDown(trigger, { key: 'Enter' })
    })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('menu').getAttribute('aria-labelledby')).toBe('trigger')
    await waitFor(() => expect(document.activeElement?.textContent).toContain('Bold'))

    act(() => {
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    })
    expect(document.activeElement).toBe(trigger)

    act(() => {
      fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    })
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Italic'))
  })

  test('items run their action from the keyboard and announce their shortcut', async () => {
    const { trigger, onAction } = await setup()
    act(() => {
      fireEvent.keyDown(trigger, { key: 'Enter' })
    })
    const item = await screen.findByRole('menuitem', { name: 'Bold' })

    expect(item.getAttribute('aria-keyshortcuts')).toMatch(/^(Meta|Control)\+B$/)

    act(() => {
      fireEvent.keyDown(item, { key: 'Enter' })
    })
    expect(onAction).toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  test('has no accessibility violations', async () => {
    const { trigger, container } = await setup()
    act(() => {
      fireEvent.keyDown(trigger, { key: 'Enter' })
    })
    await screen.findByRole('menu')
    expect(await axeViolations(container)).toEqual([])
  })

  test('carries data-tb hooks for a stylesheet to target', async () => {
    const { trigger, container } = await setup()
    act(() => {
      fireEvent.keyDown(trigger, { key: 'Enter' })
    })
    await screen.findByRole('menu')
    expect(new Set([...container.querySelectorAll('[data-tb]')].map((n) => n.getAttribute('data-tb')))).toEqual(new Set([
      'menu-trigger', 'menu-content', 'menu-group', 'menu-item', 'menu-icon', 'menu-label', 'menu-hotkey'
    ]))
  })
})

describe('toolbar', () => {
  function Toolbar() {
    const { actions } = usePluginRegistry()
    return (
      <ContextTools.Menu>
        <ContextTools.Group>
          {actions.filter((a) => a.plugin.class === 'leaf').map((a) => (
            <ContextTools.Item key={a.name} action={a} />
          ))}
        </ContextTools.Group>
      </ContextTools.Menu>
    )
  }

  function setup() {
    const result = renderEditor(<Toolbar />)
    const toolbar = document.querySelector('[role="toolbar"]') as HTMLElement
    return { ...result, toolbar }
  }

  test('is a named toolbar, out of reach while hidden', () => {
    const { toolbar } = setup()

    expect(toolbar.getAttribute('aria-label')).toBe('Formatting')
    expect(toolbar.hasAttribute('inert')).toBe(true)
  })

  test('buttons have names and say whether formatting is on, as it changes', async () => {
    const { editor } = setup()
    const bold = screen.getByRole('button', { name: 'Bold', hidden: true })
    expect(bold.getAttribute('aria-pressed')).toBe('false')

    act(() => Transforms.select(editor, { anchor: { path: [0, 0], offset: 0 }, focus: { path: [0, 0], offset: 5 } }))
    await act(async () => {})
    // Toggling a mark leaves the selection as it was
    act(() => Editor.addMark(editor, 'core/bold', true))
    await act(async () => {})

    expect(bold.getAttribute('aria-pressed')).toBe('true')
  })

  test('arrows move between buttons, Enter applies one', async () => {
    const { editor } = setup()
    act(() => Transforms.select(editor, { anchor: { path: [0, 0], offset: 0 }, focus: { path: [0, 0], offset: 5 } }))
    await act(async () => {})
    const bold = screen.getByRole('button', { name: 'Bold', hidden: true })
    act(() => bold.focus())

    act(() => {
      fireEvent.keyDown(bold, { key: 'ArrowRight' })
    })
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Italic')

    act(() => {
      fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
    })
    await act(async () => {})
    expect(Editor.marks(editor)?.['core/italic']).toBe(true)
  })

  test('has no accessibility violations', async () => {
    const { toolbar } = setup()
    toolbar.removeAttribute('inert')
    expect(await axeViolations(toolbar)).toEqual([])
  })

  test('carries data-tb hooks for a stylesheet to target', () => {
    const { toolbar } = setup()
    expect(toolbar.getAttribute('data-tb')).toBe('toolbar')
    expect(new Set([...toolbar.querySelectorAll('[data-tb]')].map((n) => n.getAttribute('data-tb')))).toEqual(new Set(['toolbar-group', 'toolbar-item']))
  })
})
