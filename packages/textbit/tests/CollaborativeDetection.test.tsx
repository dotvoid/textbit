import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import * as Y from '@y/y'
import { seedField } from '../lib/yjs'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { basicEditorContent } from './_fixtures'
import type { Element } from 'slate'

function makeSharedField(): Y.Node {
  const field = new Y.Doc().get('body')
  seedField(field, basicEditorContent as Element[])
  return field
}

describe('Textbit collaborative detection', () => {
  test('a Yjs value with null awareness renders as a plain editor (no remote-cursor overlay, no throw)', () => {
    const field = makeSharedField()

    const { container } = render(
      <TextbitRoot value={field} awareness={null}>
        <TextbitEditable />
      </TextbitRoot>
    )

    expect(container.querySelector('.textbit-y-overlay')).toBeNull()
    expect(screen.getByText('This is title')).toBeInTheDocument()
  })
})
