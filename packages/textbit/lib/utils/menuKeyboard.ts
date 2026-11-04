import { isMac } from './modifier'

export const MENU_ITEM = '[role="menuitem"]'
export const TOOLBAR_ITEM = '[role="button"]'

type Orientation = 'vertical' | 'horizontal'

/**
 * Arrow keys, Home and End move focus between the items of a menu or toolbar,
 * wrapping at the ends. Menus also jump to the next item starting with a typed
 * letter. Returns true when the key was handled, so the caller stops there.
 */
export function handleRovingKeys(
  event: React.KeyboardEvent,
  container: HTMLElement | null,
  selector: string,
  orientation: Orientation
): boolean {
  if (!container || event.altKey || event.ctrlKey || event.metaKey) {
    return false
  }

  const next = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'
  const previous = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'

  let target: HTMLElement | undefined
  if (event.key === next) {
    target = step(container, selector, 1)
  } else if (event.key === previous) {
    target = step(container, selector, -1)
  } else if (event.key === 'Home') {
    target = items(container, selector).at(0)
  } else if (event.key === 'End') {
    target = items(container, selector).at(-1)
  } else if (orientation === 'vertical' && /^\p{L}$|^\p{N}$/u.test(event.key)) {
    target = byFirstLetter(container, selector, event.key)
  } else {
    return false
  }

  event.preventDefault()
  target?.focus()
  return true
}

/** Focus the first or last item, e.g. when a menu opens */
export function focusItem(container: HTMLElement | null, selector: string, which: 'first' | 'last'): void {
  const list = container ? items(container, selector) : []
  ;(which === 'first' ? list.at(0) : list.at(-1))?.focus()
}

/**
 * `mod+shift+i` as an `aria-keyshortcuts` value, so screen readers can announce
 * an item's shortcut instead of reading out symbols like ⌘⇧I.
 */
export function ariaKeyShortcuts(hotkey: string | undefined, mac = isMac()): string | undefined {
  if (!hotkey) {
    return undefined
  }

  const names: Record<string, string> = {
    mod: mac ? 'Meta' : 'Control',
    cmd: 'Meta',
    command: 'Meta',
    meta: 'Meta',
    ctrl: 'Control',
    control: 'Control',
    alt: 'Alt',
    opt: 'Alt',
    option: 'Alt',
    shift: 'Shift',
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    space: 'Space'
  }

  return hotkey
    .split('+')
    .map((part) => names[part.toLowerCase()] ?? (part.length === 1 ? part.toUpperCase() : part))
    .join('+')
}

function items(container: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(selector))
    .filter((item) => item.getAttribute('aria-disabled') !== 'true')
}

function step(container: HTMLElement, selector: string, direction: 1 | -1): HTMLElement | undefined {
  const list = items(container, selector)
  if (!list.length) {
    return undefined
  }

  const current = list.indexOf(document.activeElement as HTMLElement)
  if (current === -1) {
    return direction === 1 ? list[0] : list[list.length - 1]
  }

  return list[(current + direction + list.length) % list.length]
}

function byFirstLetter(container: HTMLElement, selector: string, letter: string): HTMLElement | undefined {
  const list = items(container, selector)
  const current = list.indexOf(document.activeElement as HTMLElement)
  const ordered = [...list.slice(current + 1), ...list.slice(0, current + 1)]
  const wanted = letter.toLocaleLowerCase()

  return ordered.find((item) => visibleLabel(item).toLocaleLowerCase().startsWith(wanted))
}

/** The item's name as announced: its aria-label, else its text without hidden icons */
function visibleLabel(item: HTMLElement): string {
  const label = item.getAttribute('aria-label')
  if (label) {
    return label.trim()
  }

  let text = ''
  const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest('[aria-hidden="true"]')) {
      text += node.textContent ?? ''
    }
  }
  return text.trim()
}
