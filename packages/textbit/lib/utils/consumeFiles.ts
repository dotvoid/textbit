import type { Editor } from 'slate'
import { pluginsOf } from '../editor/pluginsOf'
import { pipeFromFiles } from './pipes'

/** What actions get as consumeFiles: the files, to this editor's consumers */
export function consumeFilesFor(editor: Editor): (files: File[]) => void {
  return (files) => pipeFromFiles(editor, pluginsOf(editor), files)
}
