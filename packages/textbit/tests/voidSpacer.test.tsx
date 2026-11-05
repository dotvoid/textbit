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
  vi.restoreAllMocks()
})

describe('void elements and their caret spacer', () => {
  test('warns, once, when a void element drops its children', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderWith('test/broken', false)
    renderWith('test/broken', false)

    const messages = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('test/broken/content'))
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('does not render its children')
  })

  test('says nothing when it renders them', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderWith('test/good', true)
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('test/good'))).toEqual([])
  })
})
