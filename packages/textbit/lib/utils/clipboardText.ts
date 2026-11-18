/**
 * Clipboard HTML and plain text without the editor's own UI.
 *
 * Slate builds both from the selected DOM, and keeps what is not editable:
 * the label on a block an agent works on, text an agent removed, a hint in an
 * empty field. Those carry data-tb-ui and are taken out here.
 */
export function withoutEditorUi(html: string): { html: string, text: string } | null {
  if (!html.includes('data-tb-ui') || typeof DOMParser === 'undefined') {
    return null
  }
  const document = new DOMParser().parseFromString(html, 'text/html')
  document.querySelectorAll('[data-tb-ui]').forEach((element) => element.remove())
  return { html: document.body.innerHTML, text: plainText(document.body).replace(/\n$/, '') }
}

/** Text as Slate writes it to the clipboard: a line per block */
function plainText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.nodeValue ?? ''
  }
  if (!(node instanceof Element) || node.hasAttribute('data-slate-spacer')) {
    return ''
  }
  if (node.tagName === 'BR' && node.parentElement?.getAttribute('data-slate-zero-width') === 'n') {
    return ''
  }
  const text = Array.from(node.childNodes).map(plainText).join('')
  const block = node.getAttribute('data-slate-node') === 'element' && !node.hasAttribute('data-slate-inline')
  return node.tagName === 'BR' || block ? `${text}\n` : text
}
