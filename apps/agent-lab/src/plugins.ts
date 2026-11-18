// The demo's plugins, as definitions: the agent must know what the editors in
// the document render
import {
  Text, Bold, Italic, Underline, Strikethrough, Code,
  UnorderedList, OrderedList, CodeBlock, Table, Link, LocalizedQuotationMarks,
  Image, Audio, Blockquote
} from '@dotvoid/textbit-plugins/definitions'

export const plugins = [
  Text({ headings: [1, 2] }),
  Bold(),
  Italic(),
  Underline(),
  Strikethrough(),
  Code(),
  UnorderedList(),
  OrderedList(),
  CodeBlock(),
  Table(),
  Link(),
  LocalizedQuotationMarks(),
  Image(),
  Audio(),
  Blockquote()
]
