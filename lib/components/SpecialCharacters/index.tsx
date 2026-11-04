import type { PluginInitFunction } from '../../types'
import { insertTextAtCaret } from '../../utils/insertTextAtCaret'
import { SPECIAL_CHARACTERS } from './characters'
import { openSpecialCharacters, SPECIAL_CHARACTERS_PLUGIN } from './open'
import type { SpecialCharacter } from './search'

export type SpecialCharactersOptions = {
  /**
   * Shortcut that opens the picker. None by default: most free-looking keys
   * belong to the browser or the OS, so only set one you know is free.
   */
  hotkey?: string
  /** Translated names keyed by code point in hex, e.g. `{ '20AC': 'eurotecken' }` */
  names?: Record<string, string>
  /** Code points in hex that replace the built-in set, in the order to show them */
  characters?: readonly string[]
}

/**
 * Opt-in plugin: a searchable list of special characters, inserted at the
 * caret. Place `Textbit.SpecialCharacterPicker` in the editor to show it, and
 * open it with the `open` action from a shortcut, menu or context menu.
 */
export const SpecialCharacters: PluginInitFunction<SpecialCharactersOptions> = (options) => {
  return {
    class: 'generic',
    name: SPECIAL_CHARACTERS_PLUGIN,
    options: {
      entries: resolveCharacters(options)
    },
    actions: [
      {
        name: 'open',
        title: 'Insert special character',
        hotkey: options?.hotkey,
        tool: () => <span aria-hidden='true'>Ω</span>,
        // Menu items only show actions that say they are visible
        visibility: () => [true, true, false],
        handler: ({ editor, event }) => {
          event?.preventDefault()
          openSpecialCharacters(editor)
        }
      },
      {
        name: 'insert',
        handler: ({ editor, args }) => {
          if (typeof args?.char === 'string') {
            insertTextAtCaret(editor, args.char)
          }
        }
      }
    ]
  }
}

function resolveCharacters(options?: SpecialCharactersOptions): SpecialCharacter[] {
  const english = new Map(SPECIAL_CHARACTERS)
  const names = new Map(
    Object.entries(options?.names ?? {}).map(([hex, name]) => [normalizeHex(hex), name])
  )
  const set = options?.characters ?? SPECIAL_CHARACTERS.map(([hex]) => hex)

  return set.flatMap((value) => {
    const hex = normalizeHex(value)
    const codePoint = parseInt(hex, 16)
    if (!/^[0-9A-F]{4,6}$/.test(hex) || codePoint > 0x10FFFF) {
      return []
    }

    const englishName = english.get(hex) ?? ''
    return [{
      char: String.fromCodePoint(codePoint),
      hex,
      name: names.get(hex) || englishName || `U+${hex}`,
      english: englishName
    }]
  })
}

function normalizeHex(hex: string): string {
  return hex.trim().replace(/^u\+/i, '').toUpperCase().padStart(4, '0')
}
