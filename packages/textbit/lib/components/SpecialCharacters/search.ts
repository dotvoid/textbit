export type SpecialCharacter = {
  char: string
  /** Code point in upper case hex, at least four digits */
  hex: string
  /** Display name: the host's translation, else the English name */
  name: string
  /** English Unicode name, empty for characters outside the built-in set */
  english: string
}

const HEX_QUERY = /^(?:u\+)?([0-9a-f]{2,6})$/

/**
 * Characters matching a query, best matches first. Every query word must start
 * a word in the translated or the English name, so a translated UI still finds
 * `€` by "euro". Case and accents are ignored. The character itself and its
 * code point (`20ac`, `U+20AC`) match too. Among equal matches the shorter name
 * wins, so "euro" puts Euro sign before Euro-currency sign.
 */
export function searchCharacters(
  characters: readonly SpecialCharacter[],
  query: string
): SpecialCharacter[] {
  const trimmed = query.trim()
  if (!trimmed) {
    return [...characters]
  }

  const folded = fold(trimmed)
  const words = folded.split(/[\s-]+/).filter(Boolean)
  const hex = HEX_QUERY.exec(folded)?.[1]

  const ranked: Array<[number, SpecialCharacter]> = []
  for (const character of characters) {
    const rank = rankOf(character, trimmed, folded, words, hex)
    if (rank !== undefined) {
      ranked.push([rank, character])
    }
  }

  // Array.prototype.sort is stable, so equal names keep code point order
  return ranked
    .sort((a, b) => a[0] - b[0] || a[1].name.length - b[1].name.length)
    .map(([, character]) => character)
}

/** Lower case without accents, so "a" finds "ä" and the reverse */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function rankOf(
  character: SpecialCharacter,
  query: string,
  folded: string,
  words: string[],
  hex: string | undefined
): number | undefined {
  if (character.char === query || (hex && character.hex.toLowerCase() === hex.padStart(4, '0'))) {
    return 0
  }

  const names = [fold(character.name), fold(character.english)].filter(Boolean)
  if (names.some((name) => name.startsWith(folded))) {
    return 1
  }

  const matchesAllWords = names.some((name) => {
    const nameWords = name.split(/[\s-]+/)
    return words.every((word) => nameWords.some((nameWord) => nameWord.startsWith(word)))
  })

  return matchesAllWords ? 2 : undefined
}
