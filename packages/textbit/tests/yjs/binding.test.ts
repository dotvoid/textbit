import { describe, expect, it } from 'vitest'
import * as Y from '@y/y'
import { TEXTBIT_2_DOCUMENT } from './_textbit2'
import { Editor, Node, Path, Text, Transforms } from 'slate'
import { bindField } from '../../lib/yjs/binding'
import { blocksOf, canonical, comparable, seedField, fieldToValue as toSlateValue } from '../../lib/yjs/model'
import { hashNode } from '../../lib/utils/hashNode'
import type { Element as SlateElement } from 'slate'
import { makeEditor, Network, newId, random, sample } from './_helpers'

function seeded() {
  const doc = new Y.Doc()
  const field = doc.get('body')
  seedField(field, structuredClone(sample))
  return { doc, field }
}

describe('the mapping', () => {
  it('reads back what was written', () => {
    const { field } = seeded()
    expect(canonical(toSlateValue(field))).toBe(canonical(sample))
  })

  it('reads a Y.js 13 document written by slate-yjs', () => {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, Uint8Array.from(Buffer.from(TEXTBIT_2_DOCUMENT, 'base64')))
    const field = doc.get('content')
    expect(canonical(toSlateValue(field))).toBe(canonical(sample))

    // and it can be edited, a property moving to an attribute of its own
    const editor = makeEditor()
    const binding = bindField(editor, field)
    Transforms.setNodes(editor, { properties: { role: 'heading-2' } } as Partial<SlateElement>, { at: [0] })
    Transforms.insertText(editor, 'Small ', { at: { path: [0, 0], offset: 2 } })
    expect(binding.check()).toBe(true)
    expect((field.get(0) as Y.Node).getAttrs()).toMatchObject({ 'p:role': 'heading-2' })
  })
})

describe('one editor per client', () => {
  function pair() {
    const network = new Network()
    const a = seeded()
    const b = { doc: network.add(new Y.Doc()) }
    network.add(a.doc)
    const editorA = makeEditor()
    const editorB = makeEditor()
    const bindingA = bindField(editorA, a.field, { origin: { name: 'A' } })
    const bindingB = bindField(editorB, b.doc.get('body'), { origin: { name: 'B' } })
    const same = () => {
      expect(bindingA.check()).toBe(true)
      expect(bindingB.check()).toBe(true)
      expect(comparable(editorA.children)).toBe(comparable(editorB.children))
    }
    return { editorA, editorB, bindingA, bindingB, same, network }
  }

  it('typing and deleting', () => {
    const { editorA, editorB, same } = pair()
    Transforms.insertText(editorA, 'Old ', { at: { path: [0, 0], offset: 2 } })
    same()
    Transforms.delete(editorB, { at: { path: [1, 0], offset: 0 }, distance: 3 })
    same()
    Transforms.delete(editorA, { at: { anchor: { path: [1, 0], offset: 1 }, focus: { path: [1, 4], offset: 3 } } })
    same()
  })

  it('marks, inline elements, properties', () => {
    const { editorA, editorB, same } = pair()
    Transforms.setNodes(editorA, { bold: true } as Partial<Text>, {
      at: { anchor: { path: [0, 0], offset: 2 }, focus: { path: [0, 0], offset: 9 } },
      match: Text.isText,
      split: true
    })
    same()
    Transforms.unsetNodes(editorB, 'bold', { at: [1], match: Text.isText, mode: 'all' })
    same()
    Transforms.insertNodes(editorB, {
      id: 'l2', type: 'core/link', class: 'inline', properties: { url: 'https://x' }, children: [{ text: 'link' }]
    } as SlateElement, { at: { path: [0, 0], offset: 1 } })
    same()
    Transforms.setNodes(editorA, { properties: { role: 'heading-2', size: 2 } } as Partial<SlateElement>, { at: [0] })
    same()
  })

  it('splitting, merging, moving, inserting and removing blocks', () => {
    const { editorA, editorB, same } = pair()
    Transforms.splitNodes(editorA, { at: { path: [1, 0], offset: 3 }, always: true })
    Transforms.setNodes(editorA, { id: 'split' } as Partial<SlateElement>, { at: [2] })
    same()
    Transforms.mergeNodes(editorB, { at: [2] })
    same()
    Transforms.moveNodes(editorA, { at: [0], to: [2] })
    same()
    Transforms.moveNodes(editorB, { at: [1, 1], to: [1, 0] })
    same()
    Transforms.insertNodes(editorA, { id: 'new', type: 'core/text', class: 'text', children: [{ text: 'New' }] } as SlateElement, { at: [1] })
    same()
    Transforms.removeNodes(editorB, { at: [0] })
    same()
  })
})

describe('several editors on one text field', () => {
  it('keeps undo per editor', () => {
    const { field } = seeded()
    const one = makeEditor()
    const two = makeEditor()
    const first = bindField(one, field, { origin: { name: 'one' } })
    const second = bindField(two, field, { origin: { name: 'two' } })
    Transforms.insertText(one, 'ONE ', { at: { path: [0, 0], offset: 0 } })
    Transforms.insertText(two, ' TWO', { at: { path: [0, 0], offset: 18 } })
    expect(Node.string(two.children[0])).toBe('ONE A harbour town TWO')
    one.undo()
    expect(Node.string(one.children[0])).toBe('A harbour town TWO')
    expect(Node.string(two.children[0])).toBe('A harbour town TWO')
    two.undo()
    expect(Node.string(two.children[0])).toBe('A harbour town')
    expect(first.check() && second.check()).toBe(true)
  })

  it('keeps a caret in the other editor where it was', () => {
    const { field } = seeded()
    const one = makeEditor()
    const two = makeEditor()
    bindField(one, field)
    bindField(two, field)
    Transforms.select(two, { path: [1, 4], offset: 4 }) // " all| winter."
    Transforms.insertText(one, 'Small ', { at: { path: [1, 0], offset: 0 } })
    Transforms.setNodes(one, { italic: true } as Partial<Text>, { at: [1, 4], match: Text.isText })
    const point = two.selection!.anchor
    const text = Node.get(two, point.path) as Text
    expect(text.text.slice(0, point.offset)).toBe(' all')
  })
})

describe('loading and remote changes never write', () => {
  it('writes nothing when an editor binds or follows others', () => {
    const network = new Network()
    const doc = new Y.Doc()
    const a = { doc, field: doc.get('body') }
    network.add(a.doc)
    const b = network.add(new Y.Doc())
    let writes = 0
    b.on('update', (_u: Uint8Array, origin: unknown) => {
      if (origin !== network) {
        writes++
      }
    })
    // A block without an id, which textbit would give one on its own edits
    a.doc.transact(() => {
      seedField(a.field, [{ type: 'core/text', class: 'text', children: [{ text: 'no id' }] } as SlateElement])
    })
    const editor = makeEditor()
    const { normalizeNode } = editor
    let normalized = 0
    editor.normalizeNode = (entry, options) => {
      normalized++
      normalizeNode(entry, options)
    }
    bindField(editor, b.get('body'))
    Transforms.insertText(makeAndBind(a.field), 'x', { at: { path: [0, 0], offset: 0 } })
    expect(writes).toBe(0)
    expect(normalized).toBe(0)
  })
})

describe('relative positions', () => {
  it('keep a cursor where it was through others typing before it', () => {
    const { doc, field } = seeded()
    const paragraph = field.get(1) as Y.Node
    const position = Y.createRelativePositionFromTypeIndex(paragraph, 8) // "Boats re|st"
    const editor = makeEditor()
    bindField(editor, field)
    Transforms.insertText(editor, 'Two ', { at: { path: [1, 0], offset: 0 } })
    const absolute = Y.createAbsolutePositionFromRelativePosition(position, doc)
    expect(absolute?.index).toBe(12)
  })
})

// SPIKE_SEEDS and SPIKE_STEPS make it the release gate's size
const SEEDS = Number(process.env.SPIKE_SEEDS ?? 5)
const STEPS = Number(process.env.SPIKE_STEPS ?? 300)

describe('convergence under random edits', () => {
  for (const live of [true, false]) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      it(`${live ? 'live' : 'delayed'} sync, seed ${seed}`, () => {
        fuzz(seed, live, STEPS)
      })
    }
  }
})

describe('an editor out of step', () => {
  it('is found by the check, put right by a re-read, or by a change to the same block', () => {
    const { field } = seeded()
    const one = makeEditor()
    const two = makeEditor()
    const binding = bindField(one, field)
    bindField(two, field)
    // A bug elsewhere changes the editor without going through the binding
    one.children = structuredClone(one.children)
    ;(one.children[0] as SlateElement).children = [{ text: 'Wrong' }]
    expect(binding.check()).toBe(false)
    expect(binding.reread()).toBe(true)
    expect(binding.check()).toBe(true)
    // Again: a change to another block leaves it to the check, one to the same block puts it right
    ;(one.children[1] as SlateElement).children = [{ text: 'Wrong too' }]
    Transforms.insertText(two, '!', { at: { path: [0, 0], offset: 0 } })
    expect(binding.check()).toBe(false)
    Transforms.insertText(two, '!', { at: { path: [1, 0], offset: 0 } })
    expect(binding.check()).toBe(true)
  })
})

function makeAndBind(field: Y.Node) {
  const editor = makeEditor()
  bindField(editor, field)
  return editor
}

// Two editors on one field in one document, a third on another client
function fuzz(seed: number, live: boolean, steps: number) {
  const rng = random(seed)
  const network = new Network({ live })
  const a = seeded()
  network.add(a.doc)
  const b = network.add(new Y.Doc())
  const editors = [
    { editor: makeEditor(), field: a.field, name: 'a1' },
    { editor: makeEditor(), field: a.field, name: 'a2' },
    { editor: makeEditor(), field: b.get('body'), name: 'b' }
  ].map((e) => ({ ...e, binding: bindField(e.editor, e.field, { origin: { name: e.name } }) }))

  for (let step = 0; step < steps; step++) {
    const chosen = rng.pick(editors)
    const before = canonical(chosen.editor.children)
    const operations: unknown[] = []
    const { apply } = chosen.editor
    chosen.editor.apply = (op) => {
      operations.push(op)
      apply(op)
    }
    randomEdit(chosen.editor, rng)
    chosen.editor.apply = apply
    // Editors on one document agree with it after every step
    for (const e of editors) {
      if (!e.binding.check()) {
        if (process.env.SPIKE_DEBUG) {
          console.log('edited by', chosen.name, 'before', before)
          console.log('operations', JSON.stringify(operations))
          console.log(e.name, 'editor', canonical(e.editor.children))
          console.log(e.name, 'y.js  ', canonical(toSlateValue(e.field)))
        }
        throw new Error(`seed ${seed} step ${step}: ${e.name} differs from Y.js`)
      }
    }
    if (!live && rng.next() < 0.3) {
      network.deliver(rng.int(network.queue.length + 1))
    }
  }
  network.flush()
  const values = editors.map((e) => comparable(blocksOf(e.editor.children)))
  for (const e of editors) {
    expect(e.binding.check(), e.name).toBe(true)
  }
  expect(values[1]).toBe(values[0])
  expect(values[2]).toBe(values[0])
  expect(editors.reduce((n, e) => n + e.binding.stats.rereads, 0)).toBe(0)
}

function randomEdit(editor: Editor, rng: ReturnType<typeof random>) {
  const texts = [...Node.texts(editor)]
  if (!texts.length) {
    Transforms.insertNodes(editor, paragraph('restart'), { at: [editor.children.length] })
    return
  }
  const [leaf, path] = rng.pick(texts)
  const point = { path, offset: rng.int(leaf.text.length + 1) }
  const kind = rng.int(10)
  switch (kind) {
    case 0:
    case 1:
    case 2:
      Transforms.insertText(editor, rng.pick(['a', 'bc', ' ', 'word ', 'ö']), { at: point })
      return
    case 3: {
      const [other, otherPath] = rng.pick(texts)
      const end = { path: otherPath, offset: rng.int(other.text.length + 1) }
      Transforms.delete(editor, { at: { anchor: point, focus: end } })
      return
    }
    case 4: {
      const [other, otherPath] = rng.pick(texts)
      const range = { anchor: point, focus: { path: otherPath, offset: rng.int(other.text.length + 1) } }
      const mark = rng.pick(['bold', 'italic'])
      if (rng.next() < 0.5) {
        Transforms.setNodes(editor, { [mark]: true } as Partial<Text>, { at: range, match: Text.isText, split: true })
      } else {
        Transforms.unsetNodes(editor, mark, { at: range, match: Text.isText, split: true })
      }
      return
    }
    case 5: {
      const block = Editor.above(editor, { at: point, match: (n) => Editor.isBlock(editor, n as never) })
      if (block && Editor.isBlock(editor, block[0])) {
        Transforms.splitNodes(editor, { at: point, always: true, match: (n) => n === block[0] })
        Transforms.setNodes(editor, { id: newId() } as Partial<SlateElement>, { at: Path.next(block[1]) })
      }
      return
    }
    case 6: {
      const top = path[0]
      if (top > 0) {
        const previous = editor.children[top - 1] as SlateElement
        const current = editor.children[top] as SlateElement
        const textual = (el: SlateElement) => el.class === 'text'
        if (textual(previous) && textual(current)) {
          Transforms.mergeNodes(editor, { at: [top] })
        }
      }
      return
    }
    case 7:
      Transforms.setNodes(editor, { properties: { role: rng.pick(['heading-1', 'heading-2', 'preamble']) } } as Partial<SlateElement>, { at: [path[0]] })
      return
    case 8: {
      if (editor.children.length > 1) {
        const from = rng.int(editor.children.length)
        const to = rng.int(editor.children.length)
        if (from !== to) {
          Transforms.moveNodes(editor, { at: [from], to: [to] })
        }
      }
      return
    }
    case 9:
      if (rng.next() < 0.5) {
        Transforms.insertNodes(editor, paragraph(rng.pick(['New', 'More text', ''])), { at: [rng.int(editor.children.length + 1)] })
      } else if (editor.children.length > 1) {
        Transforms.removeNodes(editor, { at: [rng.int(editor.children.length)] })
      }
      return
  }
}

function paragraph(text: string): SlateElement {
  return { id: newId(), type: 'core/text', class: 'text', children: [{ text }] }
}

describe('an empty properties', () => {
  it('is no properties, in the comparison and in hashes', () => {
    const doc = new Y.Doc()
    const field = doc.get('body')
    const block = { id: 'e', type: 'core/text', class: 'text', properties: {}, children: [{ text: 'Plain' }] } as SlateElement
    seedField(field, [block])
    const editor = makeEditor()
    const binding = bindField(editor, field)
    Transforms.insertNodes(editor, { ...block, id: 'f' } as SlateElement, { at: [1] })
    expect(binding.check()).toBe(true)
    expect(hashNode(toSlateValue(field)[0])).toBe(hashNode(block))
  })
})
