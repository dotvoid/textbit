import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Descendant } from 'slate'
import {
  Textbit,
  Menu,
  Toolbar,
  ContextMenu,
  SpecialCharacters,
  useAction,
  useContextMenuHints,
  usePluginRegistry
} from '@dotvoid/textbit'
import {
  Text, Bold, Italic, Underline, Strikethrough, Code,
  UnorderedList, OrderedList, CodeBlock, Table, Link, LocalizedQuotationMarks,
  Image, Audio, Blockquote
} from '@dotvoid/textbit-plugins'
import '@dotvoid/textbit-styles'
import './demo.css'
import { document as initial } from './document'

function App() {
  const [dark, setDark] = useState(false)
  // On the page, not on <main>: the special characters pane opens in <body>
  useEffect(() => {
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }, [dark])
  const plugins = useMemo(() => [
    Text(), Bold(), Italic(), Underline(), Strikethrough(), Code(),
    UnorderedList({ placeholder: 'List item' }), OrderedList({ placeholder: 'List item' }), CodeBlock({ placeholder: 'Code' }), Table(), Link(), LocalizedQuotationMarks(),
    // Demo upload: keeps the file in the browser only
    Image({ upload: async (file) => ({ src: URL.createObjectURL(file) }) }),
    Audio({ upload: async (file) => ({ src: URL.createObjectURL(file) }) }),
    Blockquote(),
    SpecialCharacters()
  ], [])

  return (
    <main className='demo'>
      <header>
        <h1>Textbit</h1>
        <label><input type='checkbox' checked={dark} onChange={(e) => setDark(e.target.checked)} /> Dark</label>
      </header>
      <Textbit.Root value={initial as Descendant[]} onChange={() => {}} plugins={plugins} placeholders='multiple'>
        <div className='demo-editor'>
          <Textbit.Gutter>
            <GutterMenu />
          </Textbit.Gutter>
          <Textbit.Editable contextMenu='always' aria-label='Article'>
            <SelectionToolbar />
            <EditorContextMenu />
            <Textbit.SpecialCharacterPicker placeholder='Search characters' />
            <Textbit.DropMarker />
            <Textbit.UploadMarker />
          </Textbit.Editable>
        </div>
      </Textbit.Root>
    </main>
  )
}

function GutterMenu() {
  const { actions } = usePluginRegistry()
  const shown = actions.filter((a) => a.visibility && !['leaf', 'inline'].includes(a.plugin.class))
  return (
    <Menu.Root>
      <Menu.Trigger>⋮</Menu.Trigger>
      <Menu.Content>
        <Menu.Group>
          {shown.map((action) => (
            <Menu.Item key={action.name} action={action.name}>
              <Menu.Icon />
              <Menu.Label />
              <Menu.Hotkey />
            </Menu.Item>
          ))}
        </Menu.Group>
      </Menu.Content>
    </Menu.Root>
  )
}

function SelectionToolbar() {
  const { actions } = usePluginRegistry()
  return (
    <Toolbar.Root>
      <Toolbar.Group>
        {actions.filter((a) => a.plugin.class === 'leaf').map((a) => <Toolbar.Item key={a.name} action={a} />)}
      </Toolbar.Group>
      <Toolbar.Group>
        {actions.filter((a) => a.plugin.class === 'inline').map((a) => <Toolbar.Item key={a.name} action={a} />)}
      </Toolbar.Group>
    </Toolbar.Root>
  )
}

function EditorContextMenu() {
  const { spelling } = useContextMenuHints()
  const openSpecialCharacters = useAction('core/specialchars', 'open')
  return (
    <ContextMenu.Root>
      {spelling && (
        <ContextMenu.Group>
          {spelling.suggestions.map(({ text }) => (
            <ContextMenu.Item key={text} func={() => spelling.apply(text)}>{text}</ContextMenu.Item>
          ))}
        </ContextMenu.Group>
      )}
      {openSpecialCharacters && (
        <ContextMenu.Group>
          <ContextMenu.Item func={() => openSpecialCharacters()}>Insert special character…</ContextMenu.Item>
        </ContextMenu.Group>
      )}
    </ContextMenu.Root>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
