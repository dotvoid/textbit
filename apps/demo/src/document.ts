const id = () => crypto.randomUUID()
// A small inline picture, so the demo needs no network
const IMAGE = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="600" height="200" fill="#8aa"/><path d="M0 160 Q150 110 300 150 T600 140 V200 H0z" fill="#467"/></svg>')
const text = (t: string, role?: string) => ({ id: id(), type: 'core/text', class: 'text', properties: role ? { role } : {}, children: [{ text: t }] })
const cell = (t: string) => ({ id: id(), type: 'core/table/row/cell', class: 'text', children: [{ text: t }] })

export const document = [
  text('A harbour town in winter', 'heading-1'),
  { id: id(), type: 'core/text', class: 'text', properties: {}, children: [
    { text: 'Textbit with every plugin and the default styles. Some text is ' },
    { text: 'bold', 'core/bold': true },
    { text: ', some ' },
    { text: 'italic', 'core/italic': true },
    { text: ', and ' },
    { text: 'inline code', 'core/code': true },
    { text: '. Here is a ' },
    { id: id(), type: 'core/link', class: 'inline', properties: { href: 'https://example.com/' }, children: [{ text: 'link' }] },
    { text: '.' }
  ] },
  text('Lists', 'heading-2'),
  { id: id(), type: 'core/unordered-list', class: 'text', children: [
    { id: id(), type: 'core/unordered-list/list-item', class: 'text', children: [{ text: 'Fishing boats' }] },
    { id: id(), type: 'core/unordered-list/list-item', class: 'text', children: [{ text: 'A lighthouse' }] }
  ] },
  { id: id(), type: 'core/blockquote', class: 'block', children: [
    { id: id(), type: 'core/blockquote/body', class: 'text', children: [{ text: 'The sea was calm that morning.' }] },
    { id: id(), type: 'core/blockquote/citation', class: 'text', children: [{ text: 'A fisherman' }] }
  ] },
  { id: id(), type: 'core/table', class: 'block', children: [
    { id: id(), type: 'core/table/row', class: 'block', children: [cell('Boat'), cell('Catch')] },
    { id: id(), type: 'core/table/row', class: 'block', children: [cell('Maja'), cell('Herring')] }
  ] },
  { id: id(), type: 'core/code-block', class: 'block', children: [
    { id: id(), type: 'core/code-block/body', class: 'text', children: [{ text: 'const catch = boats.map((b) => b.hold)' }] }
  ] },
  text('Empty parts, where placeholders show', 'heading-2'),
  { id: id(), type: 'core/ordered-list', class: 'text', children: [
    { id: id(), type: 'core/ordered-list/list-item', class: 'text', children: [{ text: 'First' }] },
    { id: id(), type: 'core/ordered-list/list-item', class: 'text', children: [{ text: '' }] }
  ] },
  { id: id(), type: 'core/blockquote', class: 'block', children: [
    { id: id(), type: 'core/blockquote/body', class: 'text', children: [{ text: '' }] },
    { id: id(), type: 'core/blockquote/citation', class: 'text', children: [{ text: '' }] }
  ] },
  { id: id(), type: 'core/code-block', class: 'block', children: [
    { id: id(), type: 'core/code-block/body', class: 'text', children: [{ text: '' }] }
  ] },
  { id: id(), type: 'core/image', class: 'block', properties: { src: IMAGE, alt: '' }, children: [
    { id: id(), type: 'core/image/content', class: 'void', children: [{ text: '' }] },
    { id: id(), type: 'core/image/caption', class: 'text', children: [{ text: '' }] }
  ] },
  text('The end.')
]
