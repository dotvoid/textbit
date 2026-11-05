import { describe, test, expect } from 'vitest'
import { render } from '@testing-library/react'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { usePluginRegistry } from '../lib/hooks/usePluginRegistry'
import { Plugins } from '../lib/main'

function registered(plugins?: Parameters<typeof TextbitRoot>[0]['plugins']) {
  let names: string[] = []
  function Capture() {
    names = usePluginRegistry().plugins.map((p) => p.name)
    return null
  }
  const { container } = render(
    <TextbitRoot value='A simple field' onChange={() => {}} plugins={plugins}>
      <TextbitEditable><Capture /></TextbitEditable>
    </TextbitRoot>
  )
  return { names, container }
}

describe('core without plugins', () => {
  test('is a plain text field: a paragraph, and no formatting', () => {
    const { names, container } = registered()

    expect(names).toContain('base/text')
    expect(names.filter((n) => ['base/bold', 'base/italic', 'base/underline'].includes(n))).toEqual([])
    expect(container.textContent).toContain('A simple field')
  })

  test('Textbit.Plugins is only the plain paragraph', () => {
    expect(Plugins.map((p) => p().name)).toEqual(['base/text'])
  })
})
