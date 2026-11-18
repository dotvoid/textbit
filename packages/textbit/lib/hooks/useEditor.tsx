import { useSlateStatic } from 'slate-react'
import type { Editor } from 'slate'

/**
 * The editor, to read the document or change it with Slate's transforms.
 * Inside `Textbit.Root`. It does not re-render on changes; use Slate's
 * `useSlateSelector` for that.
 */
export function useEditor(): Editor {
  return useSlateStatic()
}
