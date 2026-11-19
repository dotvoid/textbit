import { it } from 'vitest'
import * as Y from '@y/y'
import { Transforms } from 'slate'
import { bindField } from '../src/binding.ts'
import { seedField, type SlateElement } from '../src/model.ts'
import { makeEditor, Network } from './helpers.ts'

it('measures a remote keystroke in a long article', () => {
  const blocks: SlateElement[] = Array.from({ length: 300 }, (_, i) => ({
    id: `p${i}`, type: 'core/text', class: 'text',
    children: [{ text: 'Twenty words of ordinary article text, ' }, { text: 'some bold', bold: true } as never, { text: ' and the rest of a sentence that goes on.' }]
  }))
  const network = new Network()
  const a = network.add(new Y.Doc())
  seedField(a.get('body'), blocks)
  const b = network.add(new Y.Doc())
  const writer = makeEditor()
  bindField(writer, a.get('body'))
  const reader = makeEditor()
  bindField(reader, b.get('body'))
  const n = 200
  const start = performance.now()
  for (let i = 0; i < n; i++) {
    Transforms.insertText(writer, 'x', { at: { path: [150, 0], offset: 5 } })
  }
  const per = (performance.now() - start) / n
  console.log(`300 blocks, about 6,000 words: ${per.toFixed(2)} ms per keystroke, writer and reader together`)
})
