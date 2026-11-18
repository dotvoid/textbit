import { describe, test, expect } from 'vitest'
import { diffWords } from '../lib/utils/diffWords'

describe('diffWords', () => {
  test('a spelling fix is one change of one word', () => {
    expect(diffWords('Spelling: teh mistake', 'Spelling: the mistake')).toEqual([{ at: 10, from: 10, added: 'the', removed: 'teh' }])
  })

  test('a rewritten phrase, an addition and a removal', () => {
    expect(diffWords('the town grows quiet.', 'the town turns inward for the season.')).toEqual([
      { at: 9, from: 9, added: 'turns inward for the season.', removed: 'grows quiet.' }
    ])
    expect(diffWords('One two', 'One and two')).toEqual([{ at: 4, from: 4, added: 'and ', removed: '' }])
    expect(diffWords('One and two', 'One two')).toEqual([{ at: 4, from: 4, added: '', removed: 'and ' }])
  })

  test('new text is all added; the same text is nothing', () => {
    expect(diffWords('', 'Hello there')).toEqual([{ at: 0, from: 0, added: 'Hello there', removed: '' }])
    expect(diffWords('Same', 'Same')).toEqual([])
  })
})

test('places each change in the old text too', () => {
  expect(diffWords('a b c d', 'a x c y d')).toEqual([
    { at: 2, from: 2, added: 'x', removed: 'b' },
    { at: 6, from: 6, added: 'y ', removed: '' }
  ])
})
