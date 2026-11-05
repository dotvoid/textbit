import { TextbitEditor } from '../../../utils/textbit-editor'
import { PluginInitFunction, ComponentProps } from '../../../types'
import { TEXT_TYPE } from '../../../utils/textType'


export const Text: PluginInitFunction = () => {
  return {
    class: 'text',
    name: TEXT_TYPE,
    componentEntry: {
      class: 'text',
      component: TextComponent,
      placeholder: '¶'
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


function TextComponent(props: ComponentProps) {
  return <>{props.children}</>
}
