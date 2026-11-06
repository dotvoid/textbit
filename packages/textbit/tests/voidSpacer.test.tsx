import { describe, test, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import type { Descendant } from 'slate'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { StandardPlugins } from '../lib/components/core'
import type { PluginDefinition, ComponentProps } from '../lib/types'

function voidPlugin(type: string, rendersChildren: boolean): PluginDefinition {
  return {
    class: 'block',
    name: type,
    componentEntry: {
      class: 'block',
      component: ({ children }: ComponentProps) => <div>{children}</div>,
      children: [{
        type: 'content',
        class: 'void',
        component: ({ children }: ComponentProps) => (
          <>
            <div contentEditable={false}>picture</div>
            {rendersChildren && children}
          </>
        )
      }]
    }
  }
}

function renderWith(type: string, rendersChildren: boolean) {
  const value: Descendant[] = [{
    id: 'b', type, class: 'block', children: [
      { id: 'c', type: `${type}/content`, class: 'void', children: [{ text: '' }] }
    ]
  } as Descendant]
  render(
    <TextbitRoot value={value} onChange={() => {}} plugins={[...StandardPlugins.map((p) => p()), voidPlugin(type, rendersChildren)]}>
      <TextbitEditable />
    </TextbitRoot>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// slate-react reports an element that does not render its children through
// editor.onDOMError, which by default passes it to the browser's reportError.
// Textbit relies on that rather than a check of its own.
describe('void elements and their caret spacer', () => {
  test('a void element that drops its children is reported, by type', () => {
    const report = vi.fn()
    vi.stubGlobal('reportError', report)
    renderWith('test/broken', false)

    const messages = report.mock.calls.map((c) => String(c[0]))
    expect(messages.some((m) => m.includes('"test/broken/content"') && m.includes('children'))).toBe(true)
  })

  test('nothing is reported when it renders them', () => {
    const report = vi.fn()
    vi.stubGlobal('reportError', report)
    renderWith('test/good', true)
    expect(report).not.toHaveBeenCalled()
  })
})
