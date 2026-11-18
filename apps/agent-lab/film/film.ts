// The demo movie: Alice and Bob in one document with a writing assistant.
//
//   npm run film            (from the repository root)
//
// Starts a fresh lab document, the demo's film stage (/?film) and the agent's
// MCP server, then plays the storyboard below in headless Chrome: two people
// clicking and typing, and the agent making real tool calls through MCP. The
// screen is recorded at twice the resolution and encoded to film/out/*.mp4.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const here = dirname(fileURLToPath(import.meta.url))
const lab = resolve(here, '..')
const root = resolve(lab, '../..')
const OUT = resolve(here, 'out')
const FRAMES = resolve(OUT, 'frames')
const WIDTH = 1280
const HEIGHT = 720
const SCALE = 3
const DEMO_PORT = 5219
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))
const children: ChildProcess[] = []
const start = (command: string, args: string[], cwd: string) => {
  const child = spawn(command, args, { cwd, stdio: 'ignore' })
  children.push(child)
  return child
}

// ---- The world: a fresh document, the demo, Chrome, the agent ---------------

rmSync(resolve(lab, '.lab'), { recursive: true, force: true })
rmSync(FRAMES, { recursive: true, force: true })
mkdirSync(FRAMES, { recursive: true })

start(process.execPath, ['src/server.ts'], lab)
start(process.execPath, [resolve(root, 'node_modules/.bin/vite'), '--port', String(DEMO_PORT), '--strictPort'], resolve(root, 'apps/demo'))
await sleep(3500)

const port = 9455
start(CHROME, ['--headless', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${resolve(OUT, 'chrome')}`, 'about:blank'], lab)
let targets: { type: string, webSocketDebuggerUrl: string }[] | undefined
for (let i = 0; i < 50 && !targets; i++) {
  await sleep(200)
  targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => undefined)
}
const socket = new WebSocket(targets!.find((t) => t.type === 'page')!.webSocketDebuggerUrl)
await new Promise((done) => socket.addEventListener('open', done))

let nextId = 0
const pending = new Map<number, (value: { result?: Record<string, unknown> }) => void>()
const frames: { file: string, at: number }[] = []
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)!(message)
    pending.delete(message.id)
  }
  if (message.method === 'Page.screencastFrame') {
    const { data, sessionId, metadata } = message.params
    const file = resolve(FRAMES, `${String(frames.length).padStart(6, '0')}.jpg`)
    writeFileSync(file, Buffer.from(data, 'base64'))
    frames.push({ file, at: metadata.timestamp })
    send('Page.screencastFrameAck', { sessionId })
  }
})
const send = (method: string, params: Record<string, unknown> = {}) => new Promise<{ result?: Record<string, unknown> }>((done) => {
  pending.set(++nextId, done)
  socket.send(JSON.stringify({ id: nextId, method, params }))
})
const page = async <T>(expression: string): Promise<T> => {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return (response.result?.result as { value: T } | undefined)?.value as T
}

await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false })
await send('Page.navigate', { url: `http://localhost:${DEMO_PORT}/?film` })
for (let i = 0; i < 40 && !(await page<boolean>('!!window.__film?.ready && document.querySelectorAll("[data-slate-editor]").length === 2')); i++) {
  await sleep(250)
}
await sleep(1500)

const agent = new Client({ name: 'film', version: '0' })
await agent.connect(new StdioClientTransport({
  command: process.execPath,
  args: ['src/mcp.ts'],
  cwd: lab,
  env: { ...process.env, LAB_AGENT_NAME: 'Writing assistant', LAB_RUN_IDLE_MS: '60000' } as Record<string, string>,
  stderr: 'ignore'
}))

// ---- What the film can do ---------------------------------------------------

const ALICE = { name: 'Alice', color: '#d9480f', column: 1 }
const BOB = { name: 'Bob', color: '#1971c2', column: 2 }
type Person = typeof ALICE

/** In a person's editor */
const inEditor = (person: Person, selector = '') => `.film-person:nth-child(${person.column}) ${selector}`

const caption = (text: string) => page(`window.__film.caption(${JSON.stringify(text)})`)
/** A title card; the pointers, which are not on the stage, hide while it shows */
const card = (title: string | null, subtitle?: string) => page(`(() => {
  window.__film.card(${JSON.stringify(title)}, ${JSON.stringify(subtitle ?? '')})
  document.querySelectorAll('[id^="pointer-"]').forEach((pointer) => { pointer.style.visibility = ${title ? "'hidden'" : "'visible'"} })
})()`)
const log = (line: string, kind: 'call' | 'result' | 'note' = 'call') => page(`window.__film.log(${JSON.stringify(line)}, ${JSON.stringify(kind)})`)

/** Pointers for Alice and Bob, which the recording shows: a headless browser has none */
await page(`(() => {
  for (const [name, color] of ${JSON.stringify([[ALICE.name, ALICE.color], [BOB.name, BOB.color]])}) {
    const pointer = document.createElement('div')
    pointer.id = 'pointer-' + name
    pointer.style.cssText = 'position:fixed;left:-60px;top:-60px;z-index:99;pointer-events:none;transition:left .7s cubic-bezier(.4,0,.2,1),top .7s cubic-bezier(.4,0,.2,1)'
    pointer.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M2 2 L2 18 L7 13.5 L10.5 20.5 L13.5 19 L10 12 L17 12 Z" fill="' + color + '" stroke="white" stroke-width="1.5"/></svg><span style="position:absolute;left:18px;top:16px;padding:1px 6px;border-radius:4px;background:' + color + ';color:white;font:600 11px system-ui">' + name + '</span>'
    document.body.appendChild(pointer)
  }
})()`)

/** Move a person's pointer to an element, or to a point in it; returns the point */
async function point(person: Person, selector: string, where: 'center' | 'end-of-text' = 'center') {
  // Scroll it into view first, then measure: a smooth scroll moves it meanwhile
  const found = await page<boolean>(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    return !!element
  })()`)
  if (!found) {
    throw new Error(`Nothing at ${selector}`)
  }
  await sleep(700)
  const at = await page<[number, number] | null>(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) return null
    if (${JSON.stringify(where)} === 'end-of-text') {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.parentElement.closest('[data-slate-string]') ? 1 : 3 })
      let last = null
      while (walker.nextNode()) last = walker.currentNode
      const range = document.createRange()
      range.setStart(last, last.length)
      const rect = range.getBoundingClientRect()
      return [rect.right - 1, rect.top + rect.height / 2]
    }
    const rect = element.getBoundingClientRect()
    return [rect.left + rect.width / 2, rect.top + rect.height / 2]
  })()`)
  if (!at) {
    throw new Error(`Nothing at ${selector}`)
  }
  await page(`(() => { const p = document.getElementById('pointer-${person.name}'); p.style.left = '${at[0] - 2}px'; p.style.top = '${at[1] - 2}px' })()`)
  await sleep(800)
  return at
}

async function click(person: Person, selector: string, where: 'center' | 'end-of-text' = 'center') {
  const [x, y] = await point(person, selector, where)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
  }
  await sleep(350)
}

/** Type as a person does: a character at a time, at an uneven pace */
async function type(text: string) {
  for (const character of text) {
    await send('Input.insertText', { text: character })
    await sleep(55 + Math.random() * 70)
  }
}

async function undo() {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 })
  }
}

/** A tool call by the agent, shown in its pane */
async function tool(name: string, args: Record<string, unknown>, shown: string) {
  await log(shown)
  const result = await agent.callTool({ name, arguments: args })
  return (result as { content: { text: string }[] }).content[0].text
}

/** In a person's editor, the top-level block whose text starts so */
const block = async (person: Person, start: string) => {
  const id = await page<string | null>(`(() => {
    const editor = document.querySelector(${JSON.stringify(inEditor(person, '[data-slate-editor]'))})
    const found = [...editor.querySelectorAll('[data-slate-node="element"]')]
      .find((element) => !element.parentElement.closest('[data-slate-node="element"]') && element.textContent.replace(/^\\uFEFF/, '').startsWith(${JSON.stringify(start)}))
    return found?.dataset.id ?? null
  })()`)
  if (!id) {
    throw new Error(`No block starting ${start}`)
  }
  return inEditor(person, `[data-id="${id}"]`)
}

/** The handle of the block whose text starts so */
const handleOf = (view: string, start: string) => view.split('\n').find((line) => line.includes(`] ${start}`))?.match(/\[#(\S+)/)?.[1]

// ---- The storyboard ---------------------------------------------------------

try {
  await send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: WIDTH * SCALE, maxHeight: HEIGHT * SCALE, everyNthFrame: 1 })

  await card('Textbit 3', 'Agents in the document')
  await sleep(3500)
  await card(null)
  await sleep(600)

  await caption('Alice and Bob are writing the same article.')
  await click(ALICE, await block(ALICE, 'The boats stay'), 'end-of-text')
  await click(BOB, await block(BOB, 'Textbit with every plugin'), 'end-of-text')
  await sleep(1800)

  await caption('Alice asks the writing assistant to fix the spelling and tighten the lead-in.')
  await log('Alice: “Fix the spelling and tighten the lead-in.”', 'note')
  await sleep(1800)

  const found = await tool('document_search', { query: 'teh mistake' }, 'document_search("teh mistake")')
  await log('1 text found', 'result')
  const read = await tool('document_read', { limit: 3 }, 'document_read()')
  await log('16 blocks, revision ' + read.match(/revision: (\S+)/)![1], 'result')
  const spelling = found.match(/\[#(\S+)/)![1]
  const lead = handleOf(read, 'The boats stay')!
  const revision = read.match(/revision: (\S+)/)![1]
  await sleep(800)

  await caption('Bob keeps writing: nothing is locked.')
  const bobTypes = type(' Some boats are painted red.')
  await sleep(900)
  await tool('document_edit', { revision, operations: [
    { op: 'replaceText', id: spelling, find: 'teh', replace: 'the' },
    { op: 'replaceText', id: spelling, find: 'alot', replace: 'a lot' },
    { op: 'replaceText', id: lead, find: 'the town grows quiet', replace: 'the town turns inward' }
  ] }, 'document_edit(\n  "teh" → "the",\n  "alot" → "a lot",\n  "grows quiet" → "turns inward")')
  await log('Done', 'result')
  await bobTypes
  if (process.env.FILM_DEBUG) {
    console.log('after edit', await page<string>(`JSON.stringify({ changes: document.querySelectorAll('.tb-agent-change').length, tags: document.querySelectorAll('[data-tb="agent-tag"]').length, hidden: document.hidden, active: document.activeElement?.getAttribute('aria-label'), bob: [...document.querySelectorAll('.film-person:nth-child(2) [data-slate-node="element"]')].map((e) => e.textContent).filter((t) => t.includes('red')) })`))
  }
  await page(`document.querySelector(${JSON.stringify(inEditor(ALICE, '.tb-agent-change'))})?.scrollIntoView({ block: 'center', behavior: 'smooth' })`)

  await caption('What the assistant changed shows where it happened, in everyone’s editor.')
  await sleep(4500)
  await caption('Then it fades: the change is made.')
  await sleep(5000)

  await caption('Alice changes her mind: one click undoes the assistant’s work. Bob’s sentence stays.')
  await click(ALICE, inEditor(ALICE, '.demo-lab-status button'))
  await sleep(3500)

  await caption('Or the assistant suggests, and people decide.')
  await click(ALICE, inEditor(ALICE, '.demo-lab-status input[type=checkbox]'))
  await sleep(1200)
  await log('Alice: “Same again, and add a line about the lighthouse.”', 'note')
  await sleep(1200)
  const again = await tool('document_read', { limit: 16 }, 'document_read()')
  await log('16 blocks', 'result')
  const list = handleOf(again, 'Lists')
  await tool('document_edit', { operations: [
    { op: 'replaceText', id: spelling, find: 'teh', replace: 'the' },
    { op: 'replaceText', id: lead, find: 'the town grows quiet', replace: 'the town turns inward' },
    { op: 'insert', before: list, content: '[text] The lighthouse keeps its light on all winter.' }
  ] }, 'document_edit(\n  "teh" → "the",\n  "grows quiet" → "turns inward",\n  + a line about the lighthouse)')
  await log('Suggested: waiting for people', 'result')
  await page(`document.querySelector(${JSON.stringify(inEditor(BOB, '[data-tb="suggestion-bar"]'))})?.scrollIntoView({ block: 'center', behavior: 'smooth' })`)
  await page(`document.querySelector(${JSON.stringify(inEditor(ALICE, '[data-tb="suggestion-bar"]'))})?.scrollIntoView({ block: 'center', behavior: 'smooth' })`)

  await caption('Suggestions wait for a decision, in everyone’s editor.')
  await sleep(4000)

  await caption('Bob accepts the spelling fix.')
  const spellingBar = await page<string>(`(() => {
    const bar = [...document.querySelectorAll(${JSON.stringify(inEditor(BOB, '[data-tb="suggestion-bar"]'))})].find((b) => b.closest('[data-id]').textContent.includes('Spelling'))
    bar.closest('[data-id]').scrollIntoView({ block: 'center', behavior: 'smooth' })
    return '${inEditor(BOB, '')}[data-id="' + bar.closest('[data-id]').dataset.id + '"] [data-tb="suggestion-accept"]'
  })()`)
  await sleep(700)
  await click(BOB, spellingBar)
  await sleep(1600)

  await caption('Alice rejects the new line.')
  await click(ALICE, inEditor(ALICE, '[data-tb="suggested-block"] [data-tb="suggestion-reject"]'))
  await sleep(2000)

  await caption('Accepting was Bob’s own edit: he can undo it, and the suggestion is back.')
  await click(BOB, await block(BOB, 'Textbit with every plugin'), 'end-of-text')
  await undo()
  await sleep(4000)

  await caption('')
  await sleep(1500)

  await send('Page.stopScreencast')
  await sleep(300)
} catch (error) {
  // Leave a picture of where it went wrong, and nothing running
  const shot = await send('Page.captureScreenshot')
  writeFileSync(resolve(OUT, 'failure.png'), Buffer.from(String(shot.result?.data), 'base64'))
  console.error(`The film stopped: ${String(error)}. See ${resolve(OUT, 'failure.png')}`)
  for (const child of children) {
    child.kill()
  }
  process.exit(1)
}

// ---- To a movie -------------------------------------------------------------

const list_ = frames.map((frame, index) => {
  const next = frames[index + 1]?.at ?? frame.at + 1
  return `file '${frame.file}'\nduration ${Math.max(0.001, next - frame.at).toFixed(3)}`
}).join('\n') + `\nfile '${frames[frames.length - 1].file}'\n`
writeFileSync(resolve(OUT, 'frames.txt'), list_)
const movie = resolve(OUT, 'textbit-agents.mp4')
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', resolve(OUT, 'frames.txt'),
  '-vf', 'scale=1920:1080:flags=lanczos,format=yuv420p', '-r', '30',
  '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', movie
])
console.log(`${frames.length} frames, ${(frames[frames.length - 1].at - frames[0].at).toFixed(1)} s: ${movie}`)

await agent.close()
socket.close()
for (const child of children) {
  child.kill()
}
process.exit(0)
