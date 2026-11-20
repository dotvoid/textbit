# Accessibility

Textbit's menus, toolbar and pickers follow the WAI-ARIA patterns for menus, toolbars and
comboboxes, so they work from the keyboard and with screen readers. This guide says what
textbit does, and what is left to you.

## Reaching everything from the keyboard

| Part | Reach it with | Inside it |
|---|---|---|
| Context menu | Right-click, the Menu key, or the browser's context menu shortcut (usually Shift+F10 on Windows and Linux) | Up and Down move, wrapping at the ends. Home and End jump. A letter jumps to the next item starting with it. Enter or Space picks. Escape or Tab return to the editor. |
| Gutter menu | Tab to its button, which sits in the tab order next to the editor, or Alt+F10 when nothing is selected | Enter, Space or Down opens it on the first item, Up on the last. Moving and picking as in the context menu. Escape returns to the button, Tab to the editor. |
| Toolbar | Alt+F10 (⌥F10 on macOS) while text is selected. Formatting shortcuts such as Ctrl/⌘+B work without it. | Left and Right move between buttons, Enter or Space applies, Escape returns to the editor. |
| Special characters | The context menu or the gutter menu | Up and Down move through the results, Enter inserts, Escape closes |
| Suggestions | `Textbit.Suggestions`, wherever you place it | Ordinary buttons |

After a menu item is used, focus returns to the editor with the caret where it was, unless
the item moved focus on purpose, as opening the special characters pane does.

Objects, such as images and tables, are reached with the arrow keys: a block caret parks
before or after them, and Enter or typing there adds a paragraph. Tab moves into an object's
controls and on out of the editor. See [The editor](./the-editor.md#the-keyboard).

### The toolbar key

Alt+F10 is the toolbar key in other web editors, so it is what keyboard and screen reader
users try. Chrome, Edge and Safari do not use it, and neither do Windows or macOS. Two
caveats:

- **GNOME**, the default Linux desktop on Ubuntu and Fedora, uses Alt+F10 to maximize the
  window, so there the key never reaches the page.
- **On a Mac keyboard** F10 needs Fn held down, unless the setting to use F1, F2 and so on as
  standard function keys is on.

The key belongs to the built-in `core/toolbar` plugin. Register it again to change or remove
the key; a plugin replaces one of the same name:

```tsx
import { FocusToolbar } from '@dotvoid/textbit'

const plugins = [...myPlugins, FocusToolbar({ hotkey: 'alt+f9' })]  // or { hotkey: false }
```

Pick a key no browser, operating system or screen reader your users run already takes: a key
that is taken never reaches the page.

## What screen readers are told

- **Menus** are `role="menu"` with `menuitem` items. Shortcuts are given through
  `aria-keyshortcuts`, not read out as symbols such as ⌘⇧I.
- **Toolbar buttons** are named by their action's `title`. Formatting buttons say whether the
  formatting is on (`aria-pressed`). A hidden toolbar is `inert`, out of reach for keyboards and
  screen readers.
- **The gutter button** says it opens a menu, and whether it is open.
- **Uploads** in progress are announced from a polite live region.
- **Agents' changes** are announced once each, as a sentence from a polite live region:
  "Writing assistant changed “teh” to “the”". The labels `agentReplaced`, `agentAdded` and
  `agentDeleted` translate it.
- **New suggestions** are announced in the same way, with who made them and how many:
  "person:sam suggests 2 changes". The label `suggestionArrived` translates it.

What textbit draws in the text for the eye, such as agents' names on their changes, removed
text struck through, and suggestions, carries `data-tb-ui` and is hidden from screen readers,
which would otherwise read it as part of the text. It is also left out of copies. The same
information reaches screen readers another way: changes through the announcer, and
suggestions through `Textbit.Suggestions`, which lists each change with what it does and who
made it ("Sam replaces “teh” with “the”") and its Accept and Reject buttons. Place it in the page whenever
suggestions can appear; it is how keyboard and screen reader users review them. See
[Suggestions](./suggestions.md).

## What is up to you

- **Name the editor** with `aria-label` on `Textbit.Editable`. Without it screen readers
  announce an unnamed text box.
- **Give your actions a `title`.** It names toolbar buttons and menu items. Without one, a
  toolbar button falls back to the action's name, `toggle-bold` becoming "Toggle bold".
- **Name the gutter button.** `Menu.Trigger` is named by its content. When it shows only an
  icon, give it an `aria-label`:

  ```tsx
  <Menu.Trigger aria-label='Insert'>
    <PlusIcon aria-hidden='true' />
  </Menu.Trigger>
  ```

- **Translate.** Default names, such as the toolbar's "Formatting", are English. The toolbar,
  the context menu, the special characters pane and `Menu.Trigger` take an `aria-label` prop, the ready-made
  plugins take their titles and labels as options, and `Textbit.Root` takes `labels`.
- **Keep the gutter next to the editor in the page**, so Tab reaches its button from the
  editor.
- **Give a second route to shortcuts that may be taken.** A non-breaking space is
  Ctrl+Shift+Space on Windows and Linux, which ChromeOS uses to switch keyboard language. Offer
  the special characters pane from a menu as well.
- **Keep the announcer visually hidden, not hidden.** If you style
  `[data-tb="agent-announcer"]` yourself, do not use `display: none`, which silences it.

```tsx
<Textbit.Root value={value} onChange={setValue} plugins={plugins}>
  <Textbit.Gutter>
    <GutterMenu />
  </Textbit.Gutter>
  <Textbit.Editable aria-label='Article'>
    <SelectionToolbar />
  </Textbit.Editable>
  <Textbit.Suggestions />
</Textbit.Root>
```

## Reduced motion and forced colours

The styles package animates only under `prefers-reduced-motion: no-preference`: the agent's
writing marker and the fading of agents' changes. Spelling errors and suggestions differ in line
shape as well as colour, and in forced colours mode keep their lines. See
[Styling](./styling.md).

## Next

- [The editor](./the-editor.md): the keyboard in full.
- [Styling](./styling.md)
- The API reference lists each component's accessibility props.
