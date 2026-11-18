import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import { YjsEditor, slateNodesToInsertDelta, slatePointToRelativePosition } from '@slate-yjs/core'
import { Editor, Transforms, type Descendant, type Point } from 'slate'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { createTextbitEditor } from '../lib/editor/createTextbitEditor'
import { withoutEditorUi } from '../lib/utils/clipboardText'
import { AGENT_PRESENCE_FIELD, type AgentChange } from '../lib/types/agentPresence'

function shared() {
  const doc = new Y.Doc()
  const content = doc.get('content', Y.XmlText)
  content.applyDelta(slateNodesToInsertDelta([
    { id: 'p1', type: 'base/text', class: 'text', properties: {}, children: [{ text: 'Spelling: the mistake.' }] }
  ] as Descendant[]))
  return { doc, content }
}

/** A change as an agent publishes it, from a peer on the same document */
function change(doc: Y.Doc, from: Point, to: Point, added: string, removed: string): AgentChange {
  const peer = createTextbitEditor({ shared: doc.get('content', Y.XmlText) }) as YjsEditor & Editor
  YjsEditor.connect(peer)
  const encode = (point: Point) => Array.from(Y.encodeRelativePosition(slatePointToRelativePosition(peer.sharedRoot, peer, point)))
  const result = { id: crypto.randomUUID(), block: 'p1', from: encode(from), to: encode(to), added, removed }
  YjsEditor.disconnect(peer)
  return result
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('what an agent changed, in the text', () => {
  test('new text is tinted, removed text struck through beside it, and both are said', async () => {
    const { doc, content } = shared()
    const awareness = new Awareness(doc)
    const { container } = render(
      <TextbitRoot value={content} awareness={awareness}><TextbitEditable /></TextbitRoot>
    )
    await settle()

    const fix = change(doc, { path: [0, 0], offset: 10 }, { path: [0, 0], offset: 13 }, 'the', 'teh')
    await act(async () => {
      const agent = new Awareness(new Y.Doc())
      agent.setLocalStateField(AGENT_PRESENCE_FIELD, { name: 'Assistant', status: 'idle', blocks: [], changes: [fix] })
      applyAwarenessUpdate(awareness, encodeAwarenessUpdate(agent, [agent.clientID]), 'test')
    })
    await settle()

    const added = container.querySelector('.tb-agent-change')
    expect(added?.querySelector('[data-slate-string]')?.textContent).toBe('the')
    const removed = container.querySelector('[data-tb="agent-removed"]')
    expect(removed?.textContent).toBe('teh')
    expect(removed?.getAttribute('contenteditable')).toBe('false')
    expect(removed?.hasAttribute('data-tb-ui')).toBe(true)
    expect(container.querySelector('[data-tb="agent-announcer"]')?.textContent).toBe('Assistant changed “teh” to “the”')
    // The name, once, and no marker on the block: the edit is done
    expect([...container.querySelectorAll('[data-tb="agent-tag"]')].map((tag) => tag.textContent)).toEqual(['Assistant'])
    expect(container.querySelector('[data-tb="agent-marker"]')).toBeNull()
  })

  test('the name shows once per block, on its first change', async () => {
    const { doc, content } = shared()
    const awareness = new Awareness(doc)
    const { container } = render(
      <TextbitRoot value={content} awareness={awareness}><TextbitEditable /></TextbitRoot>
    )
    await settle()
    const later = change(doc, { path: [0, 0], offset: 14 }, { path: [0, 0], offset: 21 }, 'mistake', 'error')
    const earlier = change(doc, { path: [0, 0], offset: 10 }, { path: [0, 0], offset: 13 }, 'the', 'teh')
    await act(async () => {
      const agent = new Awareness(new Y.Doc())
      agent.setLocalStateField(AGENT_PRESENCE_FIELD, { name: 'Assistant', status: 'thinking', blocks: [], changes: [later, earlier] })
      applyAwarenessUpdate(awareness, encodeAwarenessUpdate(agent, [agent.clientID]), 'test')
    })
    await settle()
    const tags = [...container.querySelectorAll('[data-tb="agent-tag"]')]
    expect(tags).toHaveLength(1)
    expect(tags[0].closest('.tb-agent-change')?.querySelector('[data-slate-string]')?.textContent).toBe('the')
  })

  test('the mark goes when someone edits what it marks', async () => {
    const { doc, content } = shared()
    const awareness = new Awareness(doc)
    const { container } = render(
      <TextbitRoot value={content} awareness={awareness}><TextbitEditable /></TextbitRoot>
    )
    await settle()
    const fix = change(doc, { path: [0, 0], offset: 10 }, { path: [0, 0], offset: 13 }, 'the', 'teh')
    await act(async () => {
      const agent = new Awareness(new Y.Doc())
      agent.setLocalStateField(AGENT_PRESENCE_FIELD, { name: 'Assistant', status: 'idle', blocks: [], changes: [fix] })
      applyAwarenessUpdate(awareness, encodeAwarenessUpdate(agent, [agent.clientID]), 'test')
    })
    await settle()
    expect(container.querySelector('.tb-agent-change')).not.toBeNull()

    // Another person changes the word
    await act(async () => {
      const other = createTextbitEditor({ shared: doc.get('content', Y.XmlText) }) as YjsEditor & Editor
      YjsEditor.connect(other)
      Transforms.insertText(other, 'ir', { at: { path: [0, 0], offset: 13 } })
      YjsEditor.flushLocalChanges(other)
    })
    await settle()
    expect(container.querySelector('.tb-agent-change')).toBeNull()
  })
})

describe('copies', () => {
  test('leave out the editor\'s own UI', () => {
    const html = '<div data-slate-node="element"><span>The </span><span data-tb-ui="" contenteditable="false">teh</span><span>the end</span>'
      + '<div data-tb="agent-marker" data-tb-ui=""><span>Assistant is writing</span></div></div>'
      + '<div data-slate-node="element"><span>Next</span></div>'
    expect(withoutEditorUi(html)).toEqual({
      html: '<div data-slate-node="element"><span>The </span><span>the end</span></div><div data-slate-node="element"><span>Next</span></div>',
      text: 'The the end\nNext'
    })
    expect(withoutEditorUi('<p>plain</p>')).toBeNull()
  })
})

describe('how long a change is marked', () => {
  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
  })

  async function marked(duration?: number) {
    const { doc, content } = shared()
    const awareness = new Awareness(doc)
    const { container } = render(
      <TextbitRoot value={content} awareness={awareness} agentChangeDuration={duration}><TextbitEditable /></TextbitRoot>
    )
    await settle()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const fix = change(doc, { path: [0, 0], offset: 10 }, { path: [0, 0], offset: 13 }, 'the', 'teh')
    await act(async () => {
      const agent = new Awareness(new Y.Doc())
      agent.setLocalStateField(AGENT_PRESENCE_FIELD, { name: 'Assistant', status: 'idle', blocks: [], changes: [fix] })
      applyAwarenessUpdate(awareness, encodeAwarenessUpdate(agent, [agent.clientID]), 'test')
    })
    const state = () => container.querySelector('.tb-agent-fading') ? 'fading' : container.querySelector('.tb-agent-change') ? 'marked' : 'gone'
    const wait = (ms: number) => act(async () => {
      vi.advanceTimersByTime(ms)
    })
    return { state, wait }
  }

  test('fades after a while, then goes', async () => {
    const { state, wait } = await marked(1000)
    expect(state()).toBe('marked')
    await wait(999)
    expect(state()).toBe('marked')
    await wait(1)
    expect(state()).toBe('fading')
    await wait(1200)
    expect(state()).toBe('gone')
  })

  test('time the page is hidden does not count', async () => {
    const { state, wait } = await marked(1000)
    await wait(600)
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await wait(60000)
    expect(state()).toBe('marked')

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await wait(399)
    expect(state()).toBe('marked')
    await wait(1)
    expect(state()).toBe('fading')
  })

  test('0 keeps it until dismissed', async () => {
    const { state, wait } = await marked(0)
    await wait(600000)
    expect(state()).toBe('marked')
  })
})
