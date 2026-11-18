import { Element, type Editor } from 'slate'
import { ReactEditor } from 'slate-react'

// What the browser's Tab order includes, other editors among them
const FOCUSABLE = [
  'button', 'a[href]', 'input', 'select', 'textarea', 'summary', 'iframe',
  'audio[controls]', 'video[controls]', '[tabindex]', '[contenteditable]:not([contenteditable="false"])'
].join(', ')

/** Whether keyboard focus can reach the element by Tab */
function tabbable(element: HTMLElement): boolean {
  return element.tabIndex >= 0
    && !element.hasAttribute('disabled')
    && !element.closest('[hidden], [inert]')
}

/**
 * Whether Tab stops at an element outside the editor. An editor, this one's
 * neighbours included, is one stop: nothing inside an editable region is
 * one, and the region itself is, whatever its tabIndex says.
 */
function tabStop(element: HTMLElement): boolean {
  const host = element.parentElement?.closest<HTMLElement>(EDITING_HOST)
  if (host) {
    return false
  }
  if (element.matches(EDITING_HOST)) {
    return !element.closest('[hidden], [inert]') && Number(element.getAttribute('tabindex') ?? 0) >= 0
  }
  return tabbable(element)
}

const EDITING_HOST = '[contenteditable]:not([contenteditable="false"])'

/**
 * The controls of the top-level object at index, such as its buttons, in
 * reading order. Editable text is not a control; a text block has none.
 */
export function objectControls(editor: Editor, index: number): HTMLElement[] {
  const block = editor.children[index]
  if (!Element.isElement(block) || block.class === 'text') {
    return []
  }

  let element: HTMLElement
  try {
    element = ReactEditor.toDOMNode(editor, block)
  } catch {
    return []
  }

  return [...element.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter((control) => !control.isContentEditable && tabbable(control))
}

/**
 * Move focus out of the editor, to the next element Tab reaches after it, or
 * the one before it, skipping everything inside it, objects' controls
 * included. Without one, focus leaves the editor for the page itself.
 */
export function focusOutsideEditor(editor: Editor, forward: boolean): void {
  let root: HTMLElement
  try {
    root = ReactEditor.toDOMNode(editor, editor)
  } catch {
    return
  }

  const outside = [...root.ownerDocument.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter((element) => !root.contains(element) && element !== root && tabStop(element))
  const target = forward
    ? outside.find((element) => root.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
    : [...outside].reverse().find((element) => root.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING)

  if (target) {
    target.focus()
  } else {
    root.blur()
  }
}
