// The address field of a link, from one link straight to another
import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useSlateStatic } from 'slate-react'
import { Node, type Descendant, type Path } from 'slate'
import { Textbit, type TBToolComponentProps } from '@dotvoid/textbit'
import { Link, Text } from '../lib'

const link = (id: string, href: string, text: string) =>
  ({ id, class: 'inline', type: 'base/link', properties: { href }, children: [{ text }] })

const value = [{
  id: 'p', class: 'text', type: 'base/text', children: [
    { text: '' }, link('la', 'https://a.example/', 'A'), { text: ' ' },
    link('lb', 'https://b.example/', 'B'), { text: '' }
  ]
}] as Descendant[]

const plugins = [Text(), Link()]
const tools = Link().view!.tools as { edit: [unknown, (props: TBToolComponentProps) => React.ReactNode] }
const EditTool = tools.edit[1]

function Probe({ at }: { at: Path }) {
  const editor = useSlateStatic()
  const entry = [Node.get(editor, at), at] as TBToolComponentProps['entry']
  return <>{EditTool({ editor, active: true, entry })}</>
}

describe('the link editor', () => {
  test('shows the address of the link it is on, not of the one before', () => {
    const page = (at: Path) => (
      <Textbit.Root value={value} onChange={() => {}} plugins={plugins}>
        <Textbit.Editable aria-label='Text'><Probe at={at} /></Textbit.Editable>
      </Textbit.Root>
    )
    const { rerender } = render(page([0, 1]))
    expect((screen.getByRole('textbox', { name: /address/i, hidden: true }) as HTMLInputElement).value)
      .toBe('https://a.example/')
    rerender(page([0, 3]))
    expect((screen.getByRole('textbox', { name: /address/i, hidden: true }) as HTMLInputElement).value)
      .toBe('https://b.example/')
  })
})
