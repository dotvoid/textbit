# @dotvoid/textbit-styles

A default look for [`@dotvoid/textbit`](https://github.com/dotvoid/textbit/tree/main/packages/textbit) and
[`@dotvoid/textbit-plugins`](https://github.com/dotvoid/textbit/tree/main/packages/plugins), in plain CSS. No build step and no
framework: import it, and adjust it with custom properties.

```bash
npm install @dotvoid/textbit-styles
```

```ts
import '@dotvoid/textbit-styles'
```

Or only the parts you want:

```ts
import '@dotvoid/textbit-styles/fonts.css'       // the default faces, optional
import '@dotvoid/textbit-styles/variables.css'   // design tokens, needed by the others
import '@dotvoid/textbit-styles/editor.css'      // textbit's menus, toolbar, pickers and spelling marks
import '@dotvoid/textbit-styles/plugins.css'     // the plugins
```

## Fonts

Text is set in [Petrona](https://github.com/RingoSeeber/Petrona) and headings in
[Overused Grotesk](https://github.com/RandomMaerks/Overused-Grotesk), both
variable fonts under the SIL Open Font License 1.1, shipped in `fonts/` with
their licences. `fonts.css` declares them; browsers download a face only when a
page uses it. Without `fonts.css`, or when a face fails to load, text falls back
to system faces: Iowan Old Style and Avenir Next on macOS. To use your own,
override `--tb-font-text` and `--tb-font-heading`.

## Scoped

Every rule targets textbit's own hooks: the `data-tb` attributes on textbit's UI,
the `tb-*` classes the plugins render, and the spelling attributes. Nothing else on
your page is touched. The package's tests check this.

## Dark mode

Colours follow the page's `color-scheme` through CSS `light-dark()`. Set
`color-scheme: dark`, or `light dark` to follow the system, on the page or on an
element around the editor. The special characters pane opens at the end of
`<body>`, outside any element around the editor, so set it on the page (`:root`)
to have the pane follow too.

## Tokens

Override any token on `:root`, or on an element around one editor.

| Token | Use |
|-------|-----|
| `--tb-font-text`, `--tb-font-text-weight` | Body text: Petrona, weight 500 |
| `--tb-font-heading` | Headings: Overused Grotesk |
| `--tb-font-ui` | Menus, labels and captions: the system's sans serif |
| `--tb-font-mono` | Code |
| `--tb-radius`, `--tb-gap` | Corner radius, space between blocks |
| `--tb-text`, `--tb-muted` | Text, secondary text |
| `--tb-surface`, `--tb-subtle`, `--tb-border` | Popover background, quiet background, lines |
| `--tb-accent`, `--tb-accent-subtle` | Links, active items, focus |
| `--tb-shadow`, `--tb-focus` | Popover shadow, focus outline |
| `--tb-spelling-error-line`, `--tb-spelling-error-tint` | Spelling errors |
| `--tb-spelling-suggestion-line`, `--tb-spelling-suggestion-tint` | Spelling suggestions |

Spelling errors and suggestions differ in line shape (wavy against dashed) and in
tint strength, not only in colour, so they stay apart for people who do not tell
red from blue. In forced colours mode the tint goes and the shapes remain.
