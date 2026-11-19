// textbit's shapes, for Slate's types
import type { Descendant } from 'slate'

declare module 'slate' {
  interface CustomTypes {
    Element: {
      id?: string
      type?: string
      class?: string
      properties?: Record<string, unknown>
      children: Descendant[]
    }
    Text: { text: string, [mark: string]: unknown }
  }
}
