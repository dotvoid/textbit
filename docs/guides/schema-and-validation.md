# Schema and validation

A plugin can describe what its elements mean and what they store. Textbit gathers those
descriptions, with the structure the plugins already declare, into a schema of what documents
may hold. Use it to check documents before you store or publish them, to give a model the
shape of a document, or to generate a JSON Schema for your API.

The schema describes; it does not change how the editor behaves. The rules the editor keeps,
such as how many captions an image has, come from the plugins' elements and constraints
either way.

## Describing an element

Put a `schema` on a plugin's element, and on each child, and a `description` on the plugin:

```ts
import type { TBPluginDefinition } from '@dotvoid/textbit/headless'

export const Factbox = (): TBPluginDefinition => ({
  class: 'block',
  name: 'acme/factbox',
  description: 'A box of facts beside the article',
  element: {
    class: 'block',
    schema: {
      description: 'A box of facts with a heading and a body',
      properties: {
        tone: { type: 'string', enum: ['neutral', 'warning'], description: 'How it is set off' },
        sticky: { type: 'boolean' }
      }
    },
    children: [
      {
        type: 'heading',
        class: 'text',
        constraints: { min: 1, max: 1, allowBreak: false },
        schema: { description: 'The heading', marks: 'none', inlines: 'none' }
      },
      {
        type: 'body',
        class: 'text',
        constraints: { min: 1, max: 1 },
        schema: { description: 'The facts', marks: ['base/bold'], inlines: ['base/link'] }
      }
    ]
  }
})
```

| Schema field | |
|---|---|
| `description` | What the element is for, for people and models |
| `properties` | What it stores in `properties`. Each has a `type` (`'string'`, `'number'` or `'boolean'`), and optionally `description`, `required` and `enum`. |
| `marks` | Marks its text may carry: a list of mark names, `'all'` or `'none'`. Default: all. |
| `inlines` | Inline element types its text may hold: a list, `'all'` or `'none'`. Default: all. |

All of it is optional. An element without `properties` in its schema may store any properties;
once it declares some, others are reported as undeclared.

## Reading the schema

`getSchema(plugins)` returns the schema of an editor with these plugins, core's own included:

```ts
import { getSchema } from '@dotvoid/textbit/headless'
import { Text, Bold, Image } from '@dotvoid/textbit-plugins/definitions'

const schema = getSchema([Text(), Bold(), Image()])

schema.topLevel               // ['base/text', 'base/image', …]: types that may stand at the top
schema.marks                  // { 'base/bold': { description } }
schema.elements['base/image'] // { type, class, description, children, properties, … }
```

Each element type (`TBElementTypeSchema`) has its full `type`, its `class`, its `description`,
its `parent` for a child type, its `children` in order with `min` and `max`, its `properties`,
the `marks` and `inlines` its text may carry, a fixed `placeholder`, and whether Enter
(`allowBreak`) and Shift+Enter (`allowSoftBreak`) break it.

It is plain data: serialize it, send it, show it.

## Checking a document

`validate(document, plugins)` checks a document without changing it, and returns a list of
issues:

```ts
import { validate } from '@dotvoid/textbit/headless'
import { Text, Bold, Image } from '@dotvoid/textbit-plugins/definitions'

const issues = validate(document, [Text(), Bold(), Image()])
const errors = issues.filter((issue) => issue.severity === 'error')

if (errors.length) {
  throw new Error(errors.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'))
}
```

Each issue (`TBValidationIssue`) has a `code`, a `severity`, a `path` (a Slate path), the
element's `id` and `type` when it has them, and a `message` that says what is wrong and, where
it can, what would be right.

| Code | Severity | |
|---|---|---|
| `not-an-element` | error | Text at the top level |
| `unknown-type` | warning | No plugin renders the type. Not looked into further. |
| `class-mismatch` | error | The element's class is not its type's |
| `missing-id`, `duplicate-id` | error | |
| `misplaced` | error | The type does not belong where it is |
| `invalid-children` | error | Text where elements belong, or the other way round |
| `too-few`, `too-many`, `out-of-order` | error | Children against their constraints |
| `missing-property`, `invalid-property` | error | Against the schema's `properties` |
| `unknown-property` | warning | A property the schema does not declare |
| `inline-not-allowed`, `mark-not-allowed` | error | Against the schema's `inlines` and `marks` |
| `unknown-mark` | warning | No plugin provides the mark |
| `would-change` | warning | The editor would change the block when it loads |

### Why `would-change`

Not every rule fits a schema. A plugin's own repairs, in its `normalizeNode`, are code: a
table keeping its rows the same width, a list keeping its items. So after checking against the
schema, `validate` repairs a copy of the document as an editor would, and reports each
top-level block the repairs changed. A document without `would-change` loads in an editor
unchanged.

To repair rather than report, load the document in a headless editor and normalize it; see
[Without a user interface](./headless.md#changing-a-document).

### Why unknown types are warnings

A document can hold content no plugin here knows, written by an editor with a plugin this one
lacks. Textbit keeps such content as it is, so it survives a round trip through an editor that
cannot show it. `validate` follows the editor: an unknown type is worth knowing about, but not
wrong. See [Objects whose plugin is missing](./the-editor.md#objects-whose-plugin-is-missing).

## JSON Schema

`toJsonSchema(schema)` turns a schema into a JSON Schema (draft 2020-12) for a document: an
array of top-level elements, each element type a definition in `$defs` named by its type.

```ts
import { getSchema, toJsonSchema } from '@dotvoid/textbit/headless'

const jsonSchema = toJsonSchema(getSchema(plugins))
```

Elements of unknown types are allowed wherever elements are, so a valid document stays valid
when a plugin is missing. The JSON Schema checks shape, not the editor's repairs: use
`validate` for the full check.

## For models

The agent package describes a schema in a compact form a model reads, with `describeSchema`
from `@dotvoid/textbit-agent`. See [Agents](./agents.md).

## Next

- [Plugins](./plugins.md)
- [Without a user interface](./headless.md)
- The API reference has `TBDocumentSchema`, `TBElementTypeSchema`, `TBValidationIssue` and
  `TBValidationCode`.
