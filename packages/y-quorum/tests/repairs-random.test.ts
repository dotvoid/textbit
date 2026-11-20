// Two people editing one text field at once, at random, with real plugins:
// whatever their changes merge into, a repair leaves nothing broken, the same
// on both sides, the editors showing it, and a second repair changes nothing
import { describe, expect, it } from 'vitest'
import * as Y from '@y/y'
import { Editor, Node, Transforms, type Descendant } from 'slate'
import {
  createTextbitEditor, fieldToValue, repairField, seedField, sharedOf, validate,
  type TBPluginDefinition
} from '@dotvoid/textbit/headless'
import {
  Blockquote, Bold, OrderedList, Text, UnorderedList
} from '@dotvoid/textbit-plugins/definitions'

const plugins: TBPluginDefinition[] = [Text(), Bold(), Blockquote(), UnorderedList(), OrderedList()]
const SEEDS = 200
const LIST = 'base/unordered-list'

const p = (id: string, text: string): Descendant =>
  ({ id, class: 'text', type: 'base/text', children: [{ text }] }) as Descendant

const initial: Descendant[] = [
  p('a', 'Alpha one two'),
  p('b', 'Beta three four'),
  {
    id: 'q', class: 'block', type: 'base/blockquote', children: [
      { id: 'qb', class: 'text', type: 'base/blockquote/body', children: [{ text: 'Quoted' }] },
      { id: 'qc', class: 'text', type: 'base/blockquote/citation', children: [{ text: 'Someone' }] }
    ]
  } as Descendant,
  {
    id: 'l', class: 'text', type: LIST, children: [
      { id: 'l1', class: 'text', type: `${LIST}/list-item`, children: [{ text: 'First' }] },
      { id: 'l2', class: 'text', type: `${LIST}/list-item`, children: [{ text: 'Second' }] }
    ]
  } as Descendant,
  p('c', 'Gamma five six')
]

function random(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { int: (n: number) => Math.floor(next() * n) }
}

// One thing a person might do, somewhere
function act(editor: Editor, rng: ReturnType<typeof random>) {
  const texts = [...Node.texts(editor)]
  if (!texts.length) {
    return // everything was removed
  }
  const [text, path] = texts[rng.int(texts.length)]
  const offset = rng.int(text.text.length + 1)
  Transforms.select(editor, { path, offset })
  switch (rng.int(8)) {
    case 0:
      Editor.insertText(editor, 'xy')
      break
    case 1:
      Editor.insertBreak(editor)
      break
    case 2:
      Editor.deleteBackward(editor)
      break
    case 3:
      Editor.deleteForward(editor)
      break
    case 4: {
      const [other, otherPath] = texts[rng.int(texts.length)]
      Transforms.select(editor, {
        anchor: { path, offset },
        focus: { path: otherPath, offset: rng.int(other.text.length + 1) }
      })
      Editor.deleteFragment(editor)
      break
    }
    case 5:
      Transforms.removeNodes(editor, { at: [rng.int(editor.children.length)] })
      break
    case 6: {
      const plugin = plugins[2 + rng.int(3)]
      const action = plugin.actions?.find((a) => a.name === 'insert' || a.name === 'toggle')
      action?.handler({ editor } as never)
      break
    }
    default:
      Transforms.select(editor, { anchor: { path, offset: 0 }, focus: { path, offset } })
      Editor.addMark(editor, 'core/bold', true)
  }
}

describe('two people editing at once, at random', () => {
  it(`leaves nothing broken once repaired, in ${SEEDS} runs`, { timeout: 60_000 }, () => {
    const broken: string[] = []
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rng = random(seed)
      const one = new Y.Doc()
      seedField(one.get('f'), structuredClone(initial))
      const two = new Y.Doc()
      Y.applyUpdate(two, Y.encodeStateAsUpdate(one))
      const a = createTextbitEditor({ plugins, shared: one.get('f') })
      const b = createTextbitEditor({ plugins, shared: two.get('f') })
      const sync = () => {
        const toOne = Y.encodeStateAsUpdate(two, Y.encodeStateVector(one))
        Y.applyUpdate(two, Y.encodeStateAsUpdate(one, Y.encodeStateVector(two)))
        Y.applyUpdate(one, toOne)
      }
      for (let round = 0; round < 3; round++) {
        for (let k = 0; k < 1 + rng.int(3); k++) {
          act(a, rng)
          act(b, rng)
        }
        sync()
      }
      repairField(one.get('f'), { plugins })
      sync()
      const value = fieldToValue(one.get('f'))
      const errors = validate(value, plugins)
        .filter((issue) => issue.severity === 'error' || issue.code === 'would-change')
      const problems = [
        ...errors.map((issue) => issue.message),
        ...(JSON.stringify(value) !== JSON.stringify(fieldToValue(two.get('f')))
          ? ['the two differ']
          : []),
        ...(!sharedOf(a)!.check() || !sharedOf(b)!.check()
          ? ['an editor differs from its field']
          : []),
        ...(repairField(one.get('f'), { plugins }) ? ['a second repair changed something'] : [])
      ]
      broken.push(...problems.map((problem) => `seed ${seed}: ${problem}`))
    }
    expect(broken).toEqual([])
  })
})
