import { useState } from 'react'
import { Textbit } from '@dotvoid/textbit'

/** The special characters pane, remembering the last few characters inserted */
export const CharacterPicker = () => {
  const [recent, setRecent] = useState<string[]>([])

  return (
    <Textbit.SpecialCharacterPicker
      placeholder='Search characters'
      recent={recent}
      recentLabel='Recently used'
      allLabel='All'
      emptyLabel='No matching characters'
      onInsert={(char) => setRecent((r) => [char, ...r.filter((c) => c !== char)].slice(0, 8))}
    />
  )
}
