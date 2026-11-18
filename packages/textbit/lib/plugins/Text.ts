import { TextbitEditor } from '../utils/textbit-editor'
import type { PluginDefinition } from '../types/definition'
import { TEXT_TYPE } from '../utils/textType'


/** A plain paragraph, core's text block */
export const Text = (): PluginDefinition => {
  return {
    class: 'text',
    name: TEXT_TYPE,
    element: {
      class: 'text',
      placeholder: '¶',
      schema: { description: 'A paragraph' }
    },
    actions: [{
      name: 'set-text',
      title: 'Text',
      handler: ({ editor }) => {
        TextbitEditor.convertToTextNode(editor, TEXT_TYPE)
      },
      visibility: (element) => {
        return [
          element.type === TEXT_TYPE,
          true,
          element.type === TEXT_TYPE && !element?.properties?.role
        ]
      }
    }]
  }
}

