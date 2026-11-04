import { createContext, type RefObject } from 'react'

export type MenuState = {
  isOpen: boolean
  /** Open on the given item, or close */
  setIsOpen: (open: boolean, focus?: 'first' | 'last') => void
  /** Item to focus when the menu content mounts */
  focusRef: RefObject<'first' | 'last' | undefined>
  triggerId: string
  contentId: string
  triggerRef: RefObject<HTMLElement | null>
}

export const MenuContext = createContext<MenuState>({
  isOpen: false,
  setIsOpen: () => {},
  focusRef: { current: undefined },
  triggerId: '',
  contentId: '',
  triggerRef: { current: null }
})
