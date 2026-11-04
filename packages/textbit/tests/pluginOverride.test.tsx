import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Descendant } from 'slate'
import { useSlateStatic } from 'slate-react'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { usePluginRegistry } from '../lib/hooks/usePluginRegistry'
import type { PluginDefinition } from '../lib/types'

/**
 * The override contract: the last plugin registered under a name
 * replaces the earlier one, in the earlier one's position, and its
 * component renders that element type. Hosts depend on this to swap a
 * plugin by name without rebuilding the rest of the set.
 */

function boxPlugin(name: string, marker: string): PluginDefinition {
  return {
    class: 'block',
    name,
    componentEntry: {
      class: 'block',
      component: ({ children }) => <div data-marker={marker}>{children}</div>
    }
  }
}

const content: Descendant[] = [
  {
    type: 'test/box',
    class: 'block',
    id: 'box-1',
    properties: {},
    children: [{ text: 'Inside the box' }]
  }
]

function PluginNames() {
  const { plugins } = usePluginRegistry()
  const names = plugins.map((p) => p.name).filter((n) => n.startsWith('test/'))
  return <output data-testid='names'>{names.join(',')}</output>
}

function renderWith(plugins: PluginDefinition[], value: Descendant[] = content) {
  return render(
    <TextbitRoot value={value} onChange={() => {}} plugins={plugins}>
      <TextbitEditable />
      <PluginNames />
    </TextbitRoot>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('plugin override by name', () => {
  test('the last registration renders the element type', () => {
    const { container } = renderWith([
      boxPlugin('test/box', 'first'),
      boxPlugin('test/box', 'second')
    ])
    expect(container.querySelector('[data-marker="second"]')).not.toBeNull()
    expect(container.querySelector('[data-marker="first"]')).toBeNull()
  })

  test('the replacement keeps the original position', () => {
    renderWith([
      boxPlugin('test/a', 'a'),
      boxPlugin('test/box', 'first'),
      boxPlugin('test/c', 'c'),
      boxPlugin('test/box', 'second')
    ])
    expect(screen.getByTestId('names').textContent).toBe('test/a,test/box,test/c')
  })

  test('an intended override is not reported as a problem', () => {
    const warn = vi.spyOn(console, 'warn')
    renderWith([boxPlugin('test/box', 'first'), boxPlugin('test/box', 'second')])
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Overriding'))
  })
})

describe('unknown element types', () => {
  test('render inert and are kept in the document untouched', () => {
    const node: Descendant = {
      type: 'test/not-registered',
      class: 'block',
      id: 'unknown-1',
      properties: { anything: 'goes' },
      children: [{ text: 'Kept as is' }]
    }
    let editor: ReturnType<typeof useSlateStatic> | null = null
    const Probe = () => {
      editor = useSlateStatic()
      return null
    }
    const { container } = render(
      <TextbitRoot value={[node]} onChange={() => {}} plugins={[]}>
        <TextbitEditable />
        <Probe />
      </TextbitRoot>
    )

    // Shown as a non-editable void: nothing can be typed into it.
    const block = container.querySelector('[data-type="test/not-registered"]')
    expect(block?.getAttribute('contenteditable')).toBe('false')
    expect(block?.getAttribute('data-slate-void')).toBe('true')
    // Normalisation leaves it exactly as stored, content included.
    expect(editor!.children).toEqual([node])
  })
})
