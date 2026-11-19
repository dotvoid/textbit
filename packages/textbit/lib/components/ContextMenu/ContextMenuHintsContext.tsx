import { type SpellingError } from '../../types'
import { createContext } from 'react'
import { type NodeEntry, type BaseRange } from 'slate'

/** Where the context menu opened, and on what */
export interface ContextMenuHints {
  /** The pointer's position, in viewport coordinates */
  position: {
    /** From the left, in pixels */
    x: number
    /** From the top, in pixels */
    y: number
  }
  /** The DOM element under the pointer */
  target: HTMLElement
  /** The right click */
  originalEvent: MouseEvent
  /** The Slate node under the pointer */
  nodeEntry: NodeEntry
}

/** The misspelled word the context menu opened on */
export interface ContextMenuSpellingHints extends SpellingError {
  /** Where the word is */
  range?: BaseRange
  /** Replace the word with a suggestion */
  apply: (replacement: string) => void
  /** Whether the host accepted the word for this document; see `isSpellingAccepted` */
  accepted: boolean
}

export interface ContextMenuHintsProviderState {
  menu?: ContextMenuHints
  spelling?: ContextMenuSpellingHints
  dispatch: React.Dispatch<Partial<Pick<ContextMenuHintsProviderState, 'menu' | 'spelling'>>>
  /** How many context menus the host renders; without one the editor shows its own */
  hostMenus: number
  /** A host's context menu says it is there; returns its goodbye */
  registerHostMenu: () => () => void
}

export const initialState: ContextMenuHintsProviderState = {
  menu: undefined,
  spelling: undefined,
  dispatch: () => { },
  hostMenus: 0,
  registerHostMenu: () => () => { }
}


// Create the context
export const ContextMenuHintsContext = createContext(initialState)
