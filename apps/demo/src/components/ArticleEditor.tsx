import { useCallback, useMemo, useState } from 'react'
import { Element, Node, type Descendant } from 'slate'
import { Textbit, createCommentStore, type TBCommentThread, type TBSpellingError } from '@dotvoid/textbit'
import { demoPlugins } from '../lib/plugins'
import { checkSpelling } from '../lib/spelling'
import { document } from '../document'
import { GutterMenu } from './GutterMenu'
import { SelectionToolbar } from './SelectionToolbar'
import { EditorContextMenu } from './EditorContextMenu'
import { CharacterPicker } from './CharacterPicker'
import { EditorStats } from './EditorStats'
import { CommentsPanel } from './CommentsPanel'

const ME = { kind: 'person' as const, id: 'you', name: 'You' }

/** The full editor: every plugin, spelling, uploads and the default look */
export const ArticleEditor = ({ readOnly }: { readOnly: boolean }) => {
  const plugins = useMemo(() => demoPlugins(), [])
  // Kept in memory: a host would save what onChange gives
  const comments = useMemo(() => createCommentStore({ author: ME, threads: firstComments() }), [])
  const [composing, setComposing] = useState(false)
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
      comments={comments}
      className='demo-commented'
    >
      <div>
        <div className='demo-editor'>
          <Textbit.Gutter>
            <GutterMenu />
          </Textbit.Gutter>
          <Textbit.Editable contextMenu='always' aria-label='Article' isSpellingAccepted={isSpellingAccepted}>
            <SelectionToolbar />
            <EditorContextMenu onAccept={onAccept} onComment={() => setComposing(true)} />
            <CharacterPicker />
            <Textbit.DropMarker />
            <Textbit.UploadMarker />
          </Textbit.Editable>
        </div>
        <EditorStats />
      </div>
      <CommentsPanel composing={composing} onComposed={() => setComposing(false)} me={ME.id} />
    </Textbit.Root>
  )
}

// A thread on the first "harbour" of the article, as a colleague left it
function firstComments(): TBCommentThread[] {
  const block = (document as Descendant[]).find((node) => Node.string(node).includes('harbour'))
  if (!Element.isElement(block) || typeof block.id !== 'string') {
    return []
  }
  const colleague = { kind: 'person' as const, id: 'kim', name: 'Kim' }
  const at = Date.now() - 3_600_000
  return [{
    id: 'first',
    author: colleague,
    at,
    anchor: { block: block.id, quote: 'harbour', offset: Node.string(block).indexOf('harbour') },
    comments: [{ id: 'first-1', author: colleague, at, body: 'Which harbour is this? Worth naming it.' }]
  }]
}
