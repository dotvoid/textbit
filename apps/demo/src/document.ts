const id = () => crypto.randomUUID()
// A small inline picture, so the demo needs no network
const IMAGE = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600" viewBox="0 0 1600 600"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8cfd4"/><stop offset="1" stop-color="#e8eef0"/></linearGradient></defs><rect width="1600" height="600" fill="url(#s)"/><circle cx="1220" cy="190" r="70" fill="#f4f1e8"/><path d="M0 380 Q200 300 420 360 T860 340 T1300 360 T1740 340 L1600 340 V600 H0z" fill="#7d9ea6"/><path d="M0 450 Q260 400 560 440 T1100 430 T1640 425 L1600 425 V600 H0z" fill="#4f7480"/><path d="M0 520 Q300 490 700 515 T1600 505 V600 H0z" fill="#2f4f5a"/></svg>')
const text = (t: string, role?: string) => ({ id: id(), type: 'base/text', class: 'text', properties: role ? { role } : {}, children: [{ text: t }] })
const cell = (t: string) => ({ id: id(), type: 'base/table/row/cell', class: 'text', children: [{ text: t }] })

export const document = [
  text('A harbour town in winter', 'heading-1'),
  { id: id(), type: 'base/text', class: 'text', properties: {}, children: [
    { text: 'Textbit with every plugin and the default styles. Some text is ' },
    { text: 'bold', 'base/bold': true },
    { text: ', some ' },
    { text: 'italic', 'base/italic': true },
    { text: ', and ' },
    { text: 'inline code', 'base/code': true },
    { text: '. Here is a ' },
    { id: id(), type: 'base/link', class: 'inline', properties: { href: 'https://example.com/' }, children: [{ text: 'link' }] },
    { text: '.' }
  ] },
  text('Lists', 'heading-2'),
  { id: id(), type: 'base/unordered-list', class: 'text', children: [
    { id: id(), type: 'base/unordered-list/list-item', class: 'text', children: [{ text: 'Fishing boats' }] },
    { id: id(), type: 'base/unordered-list/list-item', class: 'text', children: [{ text: 'A lighthouse' }] }
  ] },
  { id: id(), type: 'base/blockquote', class: 'block', children: [
    { id: id(), type: 'base/blockquote/body', class: 'text', children: [{ text: 'The sea was calm that morning.' }] },
    { id: id(), type: 'base/blockquote/citation', class: 'text', children: [{ text: 'A fisherman' }] }
  ] },
  { id: id(), type: 'base/table', class: 'block', children: [
    { id: id(), type: 'base/table/row', class: 'block', children: [cell('Boat'), cell('Catch')] },
    { id: id(), type: 'base/table/row', class: 'block', children: [cell('Maja'), cell('Herring')] }
  ] },
  { id: id(), type: 'base/code-block', class: 'block', children: [
    { id: id(), type: 'base/code-block/body', class: 'text', children: [{ text: 'const catch = boats.map((b) => b.hold)' }] }
  ] },
  text('Empty parts, where placeholders show', 'heading-2'),
  { id: id(), type: 'base/ordered-list', class: 'text', children: [
    { id: id(), type: 'base/ordered-list/list-item', class: 'text', children: [{ text: 'First' }] },
    { id: id(), type: 'base/ordered-list/list-item', class: 'text', children: [{ text: '' }] }
  ] },
  { id: id(), type: 'base/blockquote', class: 'block', children: [
    { id: id(), type: 'base/blockquote/body', class: 'text', children: [{ text: '' }] },
    { id: id(), type: 'base/blockquote/citation', class: 'text', children: [{ text: '' }] }
  ] },
  { id: id(), type: 'base/code-block', class: 'block', children: [
    { id: id(), type: 'base/code-block/body', class: 'text', children: [{ text: '' }] }
  ] },
  { id: id(), type: 'base/image', class: 'block', properties: { src: IMAGE }, children: [
    { id: id(), type: 'base/image/content', class: 'void', children: [{ text: '' }] },
    { id: id(), type: 'base/image/alt', class: 'text', children: [{ text: '' }] },
    { id: id(), type: 'base/image/caption', class: 'text', children: [{ text: '' }] }
  ] },
  text('The end.')
]
