import { useCallback, useMemo, useState } from 'react'
import type { Descendant } from 'slate'
import { Textbit, type TBSpellingError } from '@dotvoid/textbit'
import { demoPlugins } from '../lib/plugins'
import { checkSpelling } from '../lib/spelling'
import { document } from '../document'
import { GutterMenu } from './GutterMenu'
import { SelectionToolbar } from './SelectionToolbar'
import { EditorContextMenu } from './EditorContextMenu'
import { CharacterPicker } from './CharacterPicker'
import { EditorStats } from './EditorStats'

/** The full editor: every plugin, spelling, uploads and the default look */
export const ArticleEditor = ({ readOnly }: { readOnly: boolean }) => {
  const plugins = useMemo(() => demoPlugins(), [])
  const [accepted, setAccepted] = useState<Set<string>>(() => new Set())

  const isSpellingAccepted = useCallback((error: TBSpellingError) => accepted.has(error.text), [accepted])
  const onAccept = useCallback((word: string, accept: boolean) => {
    setAccepted((words) => {
      const next = new Set(words)
      if (accept) {
        next.add(word)
      } else {
        next.delete(word)
      }
      return next
    })
  }, [])

  return (
    <Textbit.Root
      value={document as Descendant[]}
      onChange={() => {}}
      plugins={plugins}
      placeholders='multiple'
      readOnly={readOnly}
      onSpellcheck={checkSpelling}
    >
      <div className='demo-editor'>
        <Textbit.Gutter>
          <GutterMenu />
        </Textbit.Gutter>
        <Textbit.Editable contextMenu='always' aria-label='Article' isSpellingAccepted={isSpellingAccepted}>
          <SelectionToolbar />
          <EditorContextMenu onAccept={onAccept} />
          <CharacterPicker />
          <Textbit.DropMarker />
          <Textbit.UploadMarker />
        </Textbit.Editable>
      </div>
      <EditorStats />
    </Textbit.Root>
  )
}
