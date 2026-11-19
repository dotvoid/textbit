# The editor

The editor is a set of React components you put together: a root that holds the document,
the area people type in, and the menus, toolbar and markers you choose to add. This guide
goes through them, and through what the editor does on its own: the keyboard, copy and
paste, read-only, and content it has no plugin for.

## Textbit.Root

Holds the document, the plugins and the settings. Everything else goes inside it.

```tsx
<Textbit.Root value={value} onChange={setValue} plugins={plugins} lang='en'>
  <Textbit.Editable aria-label='Article' />
</Textbit.Root>
```

| Prop | Default | |
|---|---|---|
| `value` | | The document: a string, an array of elements, or a `Y.XmlText` to collaborate. See [Concepts](./concepts.md#values). |
| `onChange` | | Called with the document after people stop typing for `debounce` milliseconds. Not called in a read-only editor. |
| `plugins` | core's plain paragraph | The plugins, each a definition and its view (`TBPlugin[]`). Create them once, e.g. with `useMemo`. |
| `readOnly` | `false` | See [Read-only](#read-only). |
| `lang` | `'en'` | The document's language, used by spelling and by plugins such as typographic quotes |
| `dir` | `'ltr'` | Text direction, `'ltr'` or `'rtl'` |
| `placeholder` | `''` | Hint shown in an empty editor, with `placeholders='single'` |
| `placeholders` | `'none'` | `'single'`: `placeholder` in an empty editor. `'multiple'`: each text element's own hint, from its plugin. |
| `debounce` | `250` | Milliseconds of quiet before `onChange` |
| `onSpellcheck` | | See [Spelling](#spelling) |
| `spellcheckDebounce` | `1250` | Milliseconds of quiet before text is spellchecked |
| `comments` | | Where comments on the text are kept. See [Comments](#comments). |
| `renderer` | | For a shared document: show the text through a Y.js 14 renderer, such as who wrote what (y-quorum's `handle.attributionsRenderer()`) or the difference between versions. Text then carries `_by` and `_at`, who wrote or deleted it and when, and the leaf `data-tb-by` and `data-tb-change`. |
| `labels` | English | Text textbit itself shows, to translate. See [Labels](#labels). |
| `agentChangeDuration` | `8000` | Milliseconds what an agent changed stays marked. See [Agents](./agents.md). |
| `awareness`, `cursor` | | Cursors and presence when collaborating. See [Collaboration](./collaboration.md). |
| `verbose` | `false` | Log plugin registration to the console |
| `className`, `style` | | On the element the root renders, `[data-tb="editor"]` |

Without plugins, the editor gets core's plain paragraph, `base/text`. When you pass plugins,
it gets those instead: include a text plugin, such as `Text()` from `@dotvoid/textbit-plugins`,
or core's own with `Textbit.Plugins`:

```tsx
const plugins = [...Textbit.Plugins.map((plugin) => plugin()), MyFactbox()]
```

## Textbit.Editable

The text people write in.

| Prop | | |
|---|---|---|
| `aria-label` | | The editor's accessible name. Set it: without it screen readers announce an unnamed text box. |
| `autoFocus` | `false` | `true` or `'start'` focuses at the start, `'end'` at the end |
| `onFocus`, `onBlur` | | Focus handlers |
| `contextMenu` | `'spelling'` | When the context menu opens: on misspelled words only, or `'always'` |
| `isSpellingAccepted` | | See [Spelling](#spelling) |
| `decorations` | | See [Decorations](#decorations) |
| `constraints` | | `{ allowEdgeWhitespace: false }` trims whitespace at the start and end of text on blur |
| `className`, `style` | | On the editable element, `[data-tb="editable"]`, which has `data-state="focused"` while focused |
| `children` | | Menus, the toolbar, markers: whatever should know about the editor |

## The gutter and its menu

The gutter is a column beside the text that follows the block the caret is in. Put a menu in
it to insert blocks and change a text's role. `Menu.Item` takes an action by its full name,
`plugin/action`, and shows the action's icon, title and shortcut:

```tsx
import { Textbit, Menu, usePluginRegistry } from '@dotvoid/textbit'

function GutterMenu() {
  const { actions } = usePluginRegistry()

  return (
    <Menu.Root>
      <Menu.Trigger aria-label='Block menu'>
        <span aria-hidden='true'>⋮</span>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Group>
          {actions.filter((action) => action.plugin.class !== 'leaf' && action.title).map((action) => (
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

<div style={{ display: 'grid', gridTemplateColumns: '2.5rem 1fr' }}>
  <Textbit.Gutter>
    <GutterMenu />
  </Textbit.Gutter>
  <Textbit.Editable aria-label='Article' />
</div>
```

A menu item is shown only when its action says it applies where the caret is: a table's
row actions only in a table, for example. `Menu.Icon`, `Menu.Label` and `Menu.Hotkey` take
children to replace what they show. The shortcut is shown for the platform: `mod+b` as ⌘B on
macOS and Ctrl+B elsewhere.

## The toolbar

The toolbar appears beside the selection. `Toolbar.Item` takes an action from the registry:

```tsx
function SelectionToolbar() {
  const { actions } = usePluginRegistry()
  return (
    <Toolbar.Root>
      <Toolbar.Group>
        {actions.filter((action) => action.plugin.class === 'leaf').map((action) => (
          <Toolbar.Item key={action.name} action={action} />
        ))}
      </Toolbar.Group>
    </Toolbar.Root>
  )
}
```

`Toolbar.Root` takes an `aria-label`, `Formatting` by default.

## The context menu and spelling

### Spelling

Give the root an `onSpellcheck` function. It gets texts with their language and returns, for
each text in the same order, the misspelled words with suggestions. Textbit finds every
occurrence of a word itself, so you return words, not positions; it assigns the ids too:

```tsx
async function checkSpelling(texts: { lang: string, text: string }[]) {
  const response = await fetch('/spelling', { method: 'POST', body: JSON.stringify(texts) })
  // One array per text, in order: [{ text: 'teh', level: 'error', suggestions: [{ text: 'the' }] }]
  return response.json()
}

<Textbit.Root value={value} onChange={setValue} onSpellcheck={checkSpelling}>
```

The whole document is checked when the editor opens, after that only the texts that change.
`level` is `'error'` or `'suggestion'`.

When a word is right after all, a name for example, let people accept it. Where that decision
is stored is yours; textbit asks:

```tsx
const [accepted, setAccepted] = useState<Set<string>>(new Set())

// Memoized: it takes part in how the text is decorated
const isSpellingAccepted = useCallback((error: TBSpellingError) => accepted.has(error.text), [accepted])

<Textbit.Editable isSpellingAccepted={isSpellingAccepted} />
```

An accepted word keeps its mark and gains `data-spelling-accepted`, so it can still be
right-clicked to take the acceptance back. Deciding here, rather than filtering what
`onSpellcheck` returns, applies at once to every occurrence.

### The context menu

```tsx
import { Textbit, useContextMenuHints } from '@dotvoid/textbit'

function SpellingMenu() {
  const { spelling } = useContextMenuHints()
  if (!spelling) {
    return null
  }

  return (
    <Textbit.ContextMenu.Root>
      <Textbit.ContextMenu.Group>
        {spelling.suggestions.map(({ text }) => (
          <Textbit.ContextMenu.Item key={text} func={() => spelling.apply(text)}>{text}</Textbit.ContextMenu.Item>
        ))}
      </Textbit.ContextMenu.Group>
    </Textbit.ContextMenu.Root>
  )
}

<Textbit.Editable aria-label='Article'>
  <SpellingMenu />
</Textbit.Editable>
```

`useContextMenuHints()` gives `menu`, where the menu opened (position, target element, the
event and the node), and `spelling`, the misspelled word under it, with `apply(replacement)`
and whether it is `accepted`. By default the menu opens only on misspelled words; with
`contextMenu='always'` on the editable it opens anywhere, and `spelling` is then set only on
a misspelled word. `func` on an item gets the editor; `disabled` shows the item but keeps it
from being chosen, and the arrow keys skip it.

Plugins add their own actions for where the menu opened, such as a table's rows and columns.
They come before your items, a group per plugin, and an action that is visible but not enabled
is shown disabled. Where a plugin offers actions the menu opens whatever the `contextMenu`
mode, and without a `ContextMenu.Root` of yours the editor shows its own menu with just those.

A right-click on a misspelled word selects it, so a suggestion replaces it. Anywhere else it
puts the caret where you clicked, or keeps the selection when you click inside it.

## Comments

Comments are threads on a range of text, kept beside the document, never in it. Give the root a
store and the editor finds each thread's text, highlights it, and gives the rest through
`useComments()`, to build a panel of your own.

```tsx
import { Textbit, createCommentStore, useComments } from '@dotvoid/textbit'

const comments = useMemo(() => createCommentStore({
  author: { kind: 'person', id: user.id, name: user.name },
  threads: saved.comments,
  onChange: (threads) => save({ comments: threads })
}), [])

<Textbit.Root value={value} onChange={setValue} comments={comments}>
  <Textbit.Editable aria-label='Article' />
  <CommentsPanel />
</Textbit.Root>
```

`createCommentStore` keeps comments in memory for a host that saves them itself. A
collaboration server's client gives a store instead: with y-quorum, `handle.comments.field(['body'])`
for the editor of the `body` field, where the server decides who may do what.

`useComments()` gives:

| | |
|---|---|
| `threads` | Every thread, open and resolved, in the order of the text, each with its `range` now; a thread whose text is gone has none and comes last |
| `create(body, range?)` | Opens a thread on the selection, or on a range; returns its id |
| `reply`, `edit`, `remove`, `resolve` | Write to a thread. A deleted comment stays in its thread, emptied. |
| `active`, `setActive` | The thread being looked at: the one the caret went into, or one you set |
| `atSelection` | The open threads whose text holds the caret |
| `rights` | `'none'`, `'own'` or `'all'`, from the store |

Each thread is anchored two ways. In a shared editor, Y.js relative positions follow the text
through everyone's edits; typing at either edge stays outside the range. Every editor also keeps
the quote, the element it is in and a little text either side, so a document restored from JSON
finds its comments again. When the text is gone the thread is detached, never moved to the same
words elsewhere. `commentAnchor(editor, range)` and `resolveAnchor(editor, anchor)` do this for
code of your own.

The highlighted text has the class `tb-comment`, `tb-comment-active` for the thread being looked
at, and `data-tb-comment` lists the threads' ids.

## Decorations

Mark ranges of text without changing the document: review findings, search hits, sources.

```tsx
const decorations = useMemo<TBDecoration[]>(
  () => findings.map((finding) => ({ id: finding.id, range: finding.range })),
  [findings]
)

<Textbit.Editable decorations={decorations} />
```

Each marked piece of text gets the class `tb-mark` and `data-tb-mark` with the ids of all
decorations on it, space-separated. A range across several blocks marks each piece; select
every piece of one with `[data-tb-mark~="finding-1"]`. Ranges are Slate ranges in the
document as it is now: they are not moved along with edits, so recompute them when the
document changes. Memoize the array, as a new one redecorates the whole editor.

## Files and drops

Files dropped on the editor, or picked through an action such as the image plugin's insert,
go to the plugins that consume them. `Textbit.DropMarker` shows where a drop will land, and
`Textbit.UploadMarker` keeps a place while a plugin is still working on a file:

```tsx
<Textbit.Editable aria-label='Article'>
  <Textbit.DropMarker />
  <Textbit.UploadMarker height={80}>
    {(drop) => drop.source === 'own' ? <span>Uploading…</span> : <span>Someone is uploading</span>}
  </Textbit.UploadMarker>
</Textbit.Editable>
```

The upload marker is not part of the document. In a shared document, the others see it too,
through awareness. `usePendingDrops()` gives the drops in progress, for a status bar.

An action that opens a file dialog hands the files on with `consumeFiles`, which every action
handler gets; see [Plugins](./plugins.md#consuming-files-and-text).

## The keyboard

### Objects and the block caret

The caret cannot sit inside an object such as an image, so textbit shows a block caret
before or after it. The arrow keys move onto an object's sides, into its text fields, and on
to the next block. Up and Down from text park the caret beside an object with nothing to type
in.

| Key, at a block caret | |
|---|---|
| Enter | A new paragraph beside the object |
| Backspace, Delete | Remove what is behind or ahead |
| A character | A new paragraph with the character |
| Shift+Arrow | Select whole blocks, see below |

A click beside an object, in the editor's margin, parks the block caret on that side. A click
on the object, outside its text and its own controls, selects it whole.

### Tab

Tab leaves the editor, as in any form. Around an object, the block caret before it, the
object's controls (its buttons and links) and the block caret after it are stops on the way:

| Where | Tab | Shift+Tab |
|---|---|---|
| Block caret before an object | Its first control | Out of the editor, backwards |
| In its controls | The next control; from the last, the block caret after it | The previous one; from the first, the block caret before it |
| Block caret after an object | Out of the editor | Its last control |
| Anywhere else | Out of the editor | Out of the editor, backwards |

Escape in a control selects the object. Plugins that use Tab themselves, as tables and code
blocks do, keep it within their own content.

### Selecting whole blocks

Shift+Arrow from a block caret, or a click on an object, selects whole blocks. Shift+Arrow
extends the selection, Backspace or Delete removes it, Cmd/Ctrl+C and X copy and cut it, and
Escape leaves it. Selected blocks get `data-block-selected`. `useBlockSelection()` gives the
selection as `{ anchorIndex, focusIndex }`, or `null`.

### Shortcuts

Each action can have a `hotkey`. Only one action handles a key: the first whose hotkey
matches and whose `when`, if any, says it applies. A key the browser or the operating system
uses never reaches the page, so the ready-made plugins only set shortcuts known to be free.
Characters typed with AltGr never trigger shortcuts.

## Copy and paste

Editors on one page often have different plugins: an article with images, and a field with
only text. Copy and paste keeps each editor to what it can show.

- **Copying** a whole object carries the object; part of an object carries only its text, a
  paragraph per text field, with formatting.
- **Pasting** an element the editor has no plugin for turns it into text, if the editor it was
  copied from could show it. If that editor could not either, it was already an object whose
  plugin is missing, and it is kept as it is.

After a paste the caret is after what was pasted. What the editor shows that is not part of
the document, such as markers and hints, is left out of the copied text and HTML.

## Read-only

```tsx
<Textbit.Root value={value} readOnly>
```

Read-only means the document does not change, from any direction: no key, paste, drop, menu
item or toolbar action changes it, and `onChange` is never called. People can still select,
click an object to select it, and copy. In a shared document, what others change still
arrives, and what agents do still shows; other people's cursors are not shown.

## Objects whose plugin is missing

An element whose type no registered plugin renders, for example because the plugin was
removed or the document came from an editor with more plugins, keeps all its data. Opening,
repairing and editing the document around it never change it. Textbit shows it as an object
with its type and its text, slightly muted and not editable, and it can be selected, copied,
moved and deleted like any object.

Outside a read-only editor, it offers two actions: **Convert to text**, which replaces it with
its text as a paste would, and **Remove**. Both are ordinary edits, undone like any other.

## Non-breaking spaces and special characters

A non-breaking space keeps two words on one line, as in `10 kr`. Textbit marks each one, since
it looks like an ordinary space. On Windows and Linux Ctrl+Shift+Space types one; on macOS
Option+Space does, natively.

The special characters pane finds and inserts characters not on the keyboard. It is opt-in:

```tsx
import { Textbit, SpecialCharacters, useAction } from '@dotvoid/textbit'

const plugins = [...myPlugins, SpecialCharacters()]

<Textbit.Editable aria-label='Article' contextMenu='always'>
  <Textbit.SpecialCharacterPicker placeholder='Search characters' />
</Textbit.Editable>
```

Open it with its `open` action, from a menu item (`core/specialchars/open`) or with
`useAction('core/specialchars', 'open')`. It has no shortcut by default; `hotkey`, `names` (to
translate) and `characters` are options.

## Labels

Text the editor itself shows or announces is English unless you replace it:

```tsx
<Textbit.Root labels={{ unknownToText: 'Gör till text', unknownRemove: 'Ta bort' }}>
```

The labels cover objects whose plugin is missing, what agents do and change, and suggestions;
`{name}`, `{added}`, `{removed}` and `{count}` are filled in. Plugins take their own labels as
options.

## Hooks

| Hook | Gives |
|---|---|
| `useTextbit()` | The settings and counts: `readOnly`, `lang`, `dir`, `labels`, `stats` (words and characters) and more |
| `usePluginRegistry()` | `plugins` and `actions`, to build menus |
| `useAction(plugin, action)` | A function running the action, or `undefined` when it is not registered |
| `useContextMenuHints()` | `menu` and `spelling`, for the context menu |
| `useBlockSelection()` | The whole-block selection, or `null` |
| `useSelectionBounds()` | Where the selection is on the page |
| `useSelectionStats()` | Words and characters in the selection |
| `usePendingDrops()` | Drops in progress |
| `useAgents()`, `useAgentChanges()` | Agents in a shared document, and what they changed. See [Agents](./agents.md). |
| `useSuggestions()` | Suggestions waiting for review. See [Suggestions](./suggestions.md). |
| `useComments()` | The comment threads, where each is in the text, and writing them. See [Comments](#comments). |

Call them inside `Textbit.Root`. Their exact shapes are in the API reference.

## Next

- [Plugins](./plugins.md)
- [Styling](./styling.md)
- [Accessibility](./accessibility.md)
