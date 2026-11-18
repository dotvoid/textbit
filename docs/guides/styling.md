# Styling

Textbit renders plain HTML with stable hooks and ships no stylesheet of its own, apart from a
few rules it injects for what it draws itself, such as the block caret. How the editor looks
is up to you: take the default look from `@dotvoid/textbit-styles`, adjust it with custom
properties, or write your own against the hooks below.

## The default look

```bash
npm install @dotvoid/textbit-styles
```

```ts
import '@dotvoid/textbit-styles'
```

Or only the parts you want:

```ts
import '@dotvoid/textbit-styles/fonts.css'       // the default faces, optional
import '@dotvoid/textbit-styles/variables.css'   // the tokens, needed by the others
import '@dotvoid/textbit-styles/editor.css'      // menus, toolbar, pickers, spelling, agents, suggestions
import '@dotvoid/textbit-styles/plugins.css'     // the ready-made plugins
```

The stylesheets are plain CSS with no build step, and every rule targets textbit's own hooks.
Nothing else on your page is touched.

Text is set in Petrona and headings in Overused Grotesk, both variable fonts under the SIL
Open Font License, shipped with the package. Leave out `fonts.css` to use system faces instead.

## Tokens

Override any token on `:root`, or on an element around one editor:

```css
.article-editor {
  --tb-font-text: Georgia, serif;
  --tb-text-size: 1.125rem;
  --tb-accent: light-dark(#8a3ffc, #be95ff);
  --tb-radius: 2px;
}
```

| Token | Use |
|---|---|
| `--tb-font-text`, `--tb-font-text-weight` | Body text |
| `--tb-font-heading`, `--tb-font-heading-weight` | Headings |
| `--tb-font-ui` | Menus, labels and captions |
| `--tb-font-mono` | Code |
| `--tb-text-size`, `--tb-leading` | Text size and line height; headings, the lead-in and code scale with the size |
| `--tb-gap`, `--tb-gap-wide` | Space between paragraphs; around quotes, tables, code and media |
| `--tb-radius` | Corner radius |
| `--tb-text`, `--tb-muted` | Text, secondary text |
| `--tb-surface`, `--tb-subtle`, `--tb-border` | Popover background, quiet background, lines |
| `--tb-accent`, `--tb-accent-subtle` | Links, active items, focus |
| `--tb-shadow`, `--tb-focus` | Popover shadow, focus outline |
| `--tb-agent-color` | Agents' changes and suggestions, when an agent has no colour of its own |
| `--tb-spelling-error-line`, `--tb-spelling-error-tint` | Spelling errors |
| `--tb-spelling-suggestion-line`, `--tb-spelling-suggestion-tint` | Spelling suggestions |

These tokens are read by textbit itself, with or without the styles package:

| Token | Default | Use |
|---|---|---|
| `--tb-focus-ring-radius` | `5px` | The ring around an object the caret is in |
| `--tb-nbsp-background`, `--tb-nbsp-border`, `--tb-nbsp-radius` | a tint of the text colour | How a non-breaking space shows |
| `--tb-newline-background`, `--tb-newline-border`, `--tb-newline-radius` | a tint of the text colour | How a line break (Shift+Enter) shows |
| `--tb-newline-symbol` | `'↵'` | The symbol shown at a line break |
| `--tb-agent-color` | `#7c3aed` | As above |

## Dark mode

Colours follow the page's `color-scheme` through CSS `light-dark()`:

```css
:root { color-scheme: light dark; }  /* follow the system */
```

Set it on `:root` rather than an element around the editor: the special characters pane opens
at the end of `<body>`, outside the editor, and follows the page.

## Styling it yourself

### Textbit's own UI

Everything textbit renders carries a `data-tb` attribute. State is in `data-state`.

| `data-tb` | What it is |
|---|---|
| `editor` | The root element around everything |
| `editable` | The editable area. `data-state='focused'` while it has focus. |
| `gutter` | The column beside the text, for the menu |
| `menu`, `menu-trigger`, `menu-content`, `menu-group`, `menu-item`, `menu-icon`, `menu-label`, `menu-hotkey` | The block menu. The menu has `data-state` `open` or `closed`, an item `active` or `inactive`. |
| `toolbar`, `toolbar-group`, `toolbar-item` | The toolbar. An item has `data-state` `active` or `inactive`. |
| `context-menu`, `context-menu-group`, `context-menu-item` | The context menu |
| `special-characters` | The special characters pane |
| `unknown`, `unknown-type`, `unknown-text`, `unknown-actions`, `unknown-action` | An object whose plugin is missing |
| `agent-marker`, `agent-label` | The bar beside a block an agent is in, and the agent's name on it. `data-status='writing'` while it writes. |
| `agent-tag`, `agent-removed` | The agent's name on its changes, and text it removed |
| `agent-announcer` | What agents change, for screen readers only. Keep it visually hidden. |
| `suggested-block`, `suggested-text` | A suggestion in the text. Its `data-state` is `ready`, or `stale` once the block it was made from has changed. |
| `suggestion-bar`, `suggestion-from`, `suggestion-accept`, `suggestion-reject` | The bar on a suggestion |
| `suggestions`, `suggestion`, `suggestion-item`, `suggestion-all` | The list of suggestions, `Textbit.Suggestions` |

Markers textbit draws in the text, such as agent tags, also carry `data-tb-ui`. They are not
part of the document: they cannot be selected or copied, and screen readers skip them.

### Elements

Each element renders with its class and type as class names and in data attributes:

```html
<div class="block base/image …" data-id="…" data-type="base/image" data-state="inactive">
```

| Attribute | |
|---|---|
| `data-type` | The element's full type |
| `data-role` | Its `properties.role`, such as `heading-1` |
| `data-state` | On top-level elements: `active` while the caret is in it, `before` or `after` while the block caret is parked beside it, otherwise `inactive` |
| `data-block-selected` | While the block is part of a block selection |

The ready-made plugins render their own classes, such as `tb-image`, `tb-image-caption`,
`tb-table`, `tb-table-cell`, `tb-list`, `tb-list-item`, `tb-code-block`, `tb-blockquote`,
`tb-link` and `tb-code` for the code mark. Bold, italic, underline and strikethrough style
themselves inline, so they read right without any stylesheet.

### Text

| Hook | |
|---|---|
| `[data-spelling-error]` | A misspelled word. `data-spelling-level` says `error` or `suggestion`; `data-spelling-accepted` is set once it is accepted. |
| `.tb-mark`, `[data-tb-mark~="id"]` | Text covered by a decoration; see [The editor](./the-editor.md#decorations) |
| `.tb-nbsp` | A non-breaking space |
| `.tb-newline` | A line break |
| `.tb-agent-change`, `.tb-agent-fading` | Text an agent changed, and the same text as the change fades |
| `.tb-suggested-delete` | Text a suggestion would remove |

The styles package tells spelling errors and suggestions apart by line shape (wavy against
dashed) and tint strength as well as colour, so they stay apart for people who do not tell
red from blue. Keep that in your own styles. In forced colours mode the tint goes and the
lines remain.

## Next

- [Accessibility](./accessibility.md)
- [Plugins](./plugins.md): rendering your own elements.
- The API reference has every component and its props.
