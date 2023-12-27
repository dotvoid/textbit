import React from 'react' // Necessary for esbuild
import { render, screen } from "@testing-library/react"
import { TextbitEditable } from "./editor"
import 'jest'
import { Descendant } from 'slate'

describe("TextbitEditor", () => {
  const initialValue: Descendant[] = [
    {
      type: 'core/heading-1',
      id: 'be0ec554-839d-413c-9140-c408cb213f1e',
      class: 'text',
      children: [
        { text: 'This is title' }
      ]
    },
    {
      type: 'core/paragraph',
      class: 'text',
      id: 'fc542b22-6046-49d8-8eae-56a8597599a3',
      children: [{ text: 'This is paragraph' }],
    }
  ]

  test("renders the TextbitEditor component", () => {
    const { unmount, container } = render(<TextbitEditable value={initialValue} onChange={() => { return }} />)

    expect(screen.getByRole('textbox'))
    expect(container.querySelectorAll('div[data-id="be0ec554-839d-413c-9140-c408cb213f1e"]')).toHaveLength(2)
    expect(container.querySelectorAll('div[data-id="fc542b22-6046-49d8-8eae-56a8597599a3"]')).toHaveLength(2)
    expect(screen.getByText('This is title'))
    expect(screen.getByText('This is paragraph'))
  })
})
