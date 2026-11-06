import { useTextbit } from '@dotvoid/textbit'

/** Word and character counts for the document */
export const EditorStats = () => {
  const { stats } = useTextbit()

  return (
    <p className='demo-stats'>
      {stats.full.words} words · {stats.full.characters} characters
    </p>
  )
}
