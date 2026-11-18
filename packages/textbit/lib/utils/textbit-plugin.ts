import { type ElementDefinition, LeafDefinition } from '../types/textbit'

/** Checks of what kind a plugin is; see `TextbitPlugin` */
export interface TextbitPluginInterface {
  /** Whether a plugin is a mark, like bold */
  isLeafPlugin: (value: unknown) => value is LeafDefinition
  /** Whether a plugin is any other kind: with an element of its own, or none */
  isElementPlugin: (value: unknown) => value is ElementDefinition
}

/** Checks of what kind a plugin is */
export const TextbitPlugin: TextbitPluginInterface = {
  isLeafPlugin: (value): value is LeafDefinition => {
    return (value as LeafDefinition)?.class === 'leaf'
  },

  isElementPlugin: (value): value is ElementDefinition => {
    return (value as ElementDefinition)?.class !== 'leaf'
  }
}
