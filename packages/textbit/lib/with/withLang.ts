import { Editor } from 'slate'

/** The document's language: the one given, else the page's, else 'en' */
export function withLang(editor: Editor, lang?: string) {
  editor.lang = lang
    || (typeof document !== 'undefined' ? document.documentElement?.lang : '')
    || (typeof navigator !== 'undefined' ? navigator.language : '')
    || 'en'
  return editor
}
