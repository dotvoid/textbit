import { useMemo } from 'react'
import type { Descendant } from 'slate'
import { Textbit } from '@dotvoid/textbit'
import { demoPlugins } from '../lib/plugins'
import { checkSpelling } from '../lib/spelling'
import { sharedDocument, type Peer } from '../lib/sharedDocument'
import { GutterMenu } from './GutterMenu'
import { SelectionToolbar } from './SelectionToolbar'
import { EditorContextMenu } from './EditorContextMenu'

const content = [
  { id: 'together-1', type: 'base/text', class: 'text', properties: { role: 'heading-2' }, children: [{ text: 'Written together' }] },
  {
    id: 'together-2', type: 'base/text', class: 'text', properties: {}, children: [
      { text: 'Alice and Bob edit the same document. Type in one and it shows in the other, with each person’s cursor and selection. Drop an image in one to see the upload marker in the other.' }
    ]
  }
] as Descendant[]

/** Two people editing one document, side by side */
export const Together = () => {
  const [alice, bob] = useMemo(() => sharedDocument(content), [])

  return (
    <div className='demo-together'>
      <PeerEditor peer={alice} name='Alice' color='#d9480f' />
      <PeerEditor peer={bob} name='Bob' color='#1971c2' />
    </div>
  )
}

const PeerEditor = ({ peer, name, color }: { peer: Peer, name: string, color: string }) => {
  const plugins = useMemo(() => demoPlugins(), [])

  return (
    <div>
      <p className='demo-peer'><span style={{ background: color }} />{name}</p>
      <Textbit.Root
        value={peer.value}
        awareness={peer.awareness}
        cursor={{ data: { name, color } }}
        plugins={plugins}
        onSpellcheck={checkSpelling}
      >
        <div className='demo-editor'>
          <Textbit.Gutter>
            <GutterMenu />
          </Textbit.Gutter>
          <Textbit.Editable contextMenu='always' aria-label={`${name}’s editor`}>
            <SelectionToolbar />
            <EditorContextMenu />
            <Textbit.DropMarker />
            <Textbit.UploadMarker />
          </Textbit.Editable>
        </div>
      </Textbit.Root>
    </div>
  )
}
