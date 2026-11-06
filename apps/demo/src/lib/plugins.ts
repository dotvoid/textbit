import { SpecialCharacters, type TBPluginDefinition } from '@dotvoid/textbit'
import {
  Text, Bold, Italic, Underline, Strikethrough, Code,
  UnorderedList, OrderedList, CodeBlock, Table, Link, LocalizedQuotationMarks,
  Image, Audio, Blockquote
} from '@dotvoid/textbit-plugins'

// Demo upload: keeps the file in the browser only. The pause stands in for the
// network, so the upload marker shows while it runs.
async function upload(file: File) {
  await new Promise((resolve) => setTimeout(resolve, 1500))
  return { src: URL.createObjectURL(file) }
}

/** Every plugin, as a host would set them up */
export function demoPlugins(): TBPluginDefinition[] {
  return [
    Text({ headings: [1, 2] }),
    Bold(),
    Italic(),
    Underline(),
    Strikethrough(),
    Code(),
    UnorderedList({ placeholder: 'List item' }),
    OrderedList({ placeholder: 'List item' }),
    CodeBlock({ placeholder: 'Code' }),
    Table(),
    Link(),
    LocalizedQuotationMarks(),
    Image({ upload }),
    Audio({ upload }),
    Blockquote(),
    SpecialCharacters()
  ]
}
