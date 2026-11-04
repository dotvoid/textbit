import { describe, test, expect } from 'vitest'
import { searchCharacters, type SpecialCharacter } from '../lib/components/SpecialCharacters/search'
import { SPECIAL_CHARACTERS } from '../lib/components/SpecialCharacters/characters'
import { SpecialCharacters } from '../lib/components/SpecialCharacters'

function entries(options?: Parameters<typeof SpecialCharacters>[0]): SpecialCharacter[] {
  return SpecialCharacters(options).options?.entries as SpecialCharacter[]
}

const chars = (list: SpecialCharacter[]) => list.map((c) => c.char)

describe('special characters - built-in set', () => {
  const hexes = SPECIAL_CHARACTERS.map(([hex]) => hex)

  test('leaves out plain ASCII, which is already on the keyboard', () => {
    expect(hexes.filter((hex) => parseInt(hex, 16) < 0x7f)).toEqual([])
  })

  test('has the spaces that cannot be seen but matter for typography', () => {
    expect(hexes).toEqual(expect.arrayContaining(['00A0', '2009', '202F']))
  })

  test('every character has an English name, once, in code point order', () => {
    expect(SPECIAL_CHARACTERS.every(([, name]) => name.length > 0)).toBe(true)
    expect(new Set(hexes).size).toBe(hexes.length)
    expect([...hexes].sort((a, b) => parseInt(a, 16) - parseInt(b, 16))).toEqual(hexes)
  })

  test('names read as sentences and keep capital letters capital', () => {
    const name = (hex: string) => SPECIAL_CHARACTERS.find(([h]) => h === hex)?.[1]
    expect(name('20AC')).toBe('Euro sign')
    expect(name('00C0')).toBe('Latin capital letter A with grave')
    expect(name('00E0')).toBe('Latin small letter a with grave')
  })
})

describe('special characters - search', () => {
  const all = entries()

  test('an empty query lists everything in order', () => {
    expect(searchCharacters(all, '  ')).toEqual(all)
  })

  test('puts the closest name first: "euro" finds € before ₠', () => {
    expect(chars(searchCharacters(all, 'euro')).slice(0, 2)).toEqual(['€', '₠'])
  })

  test('every word has to match the start of a word in the name', () => {
    const found = searchCharacters(all, 'no break')
    expect(chars(found)).toContain(' ')
    expect(chars(found)).toContain(' ')
    expect(chars(searchCharacters(all, 'reak'))).toEqual([])
  })

  test('ignores case and accents in the query', () => {
    expect(chars(searchCharacters(all, 'EURO'))[0]).toBe('€')
    expect(chars(searchCharacters(all, 'éuro'))[0]).toBe('€')
  })

  test.each(['20ac', '20AC', 'U+20AC', 'u+20ac', '€'])('finds € by %s', (query) => {
    expect(chars(searchCharacters(all, query))[0]).toBe('€')
  })

  test('a query that matches nothing returns nothing', () => {
    expect(searchCharacters(all, 'zzzz')).toEqual([])
  })
})

describe('special characters - plugin options', () => {
  test('the open action reads as a command, and has no shortcut unless the host sets one', () => {
    const open = SpecialCharacters().actions?.find((a) => a.name === 'open')
    expect(open?.title).toBe('Insert special character')
    expect(open?.hotkey).toBeUndefined()
    expect(SpecialCharacters({ hotkey: 'ctrl+alt+c' }).actions?.find((a) => a.name === 'open')?.hotkey)
      .toBe('ctrl+alt+c')
  })

  test('translated names are shown, and both languages are searched', () => {
    const translated = entries({ names: { '20ac': 'eurotecken', 'U+00A0': 'hårt mellanslag' } })
    const euro = translated.find((c) => c.char === '€')

    expect(euro?.name).toBe('eurotecken')
    expect(euro?.english).toBe('Euro sign')
    expect(chars(searchCharacters(translated, 'eurotecken'))).toEqual(['€'])
    expect(chars(searchCharacters(translated, 'euro sign'))[0]).toBe('€')
    // Accents in a translated name are folded like the query
    expect(chars(searchCharacters(translated, 'hart'))).toEqual([' '])
  })

  test('untranslated characters keep their English name', () => {
    expect(entries({ names: { '20AC': 'eurotecken' } }).find((c) => c.char === '½')?.name)
      .toBe('Vulgar fraction one half')
  })

  test('a host set replaces the built-in one, in its order, skipping invalid code points', () => {
    const set = entries({ characters: ['2013', '00a0', 'nonsense', '110000', '1F600'] })

    expect(chars(set)).toEqual(['–', ' ', '😀'])
    // Outside the built-in set there is no English name to fall back to
    expect(set[2].name).toBe('U+1F600')
  })
})
