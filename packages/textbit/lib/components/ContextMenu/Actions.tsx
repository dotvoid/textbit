import { useSlateSelection, useSlateStatic } from 'slate-react'
import { usePluginRegistry } from '../../hooks/usePluginRegistry'
import { consumeFilesFor } from '../../utils/consumeFiles'
import { actionTitle, contextMenuActions } from '../../utils/actionVisibility'
import { Group } from './Group'
import { Item } from './Item'

/** The plugins' actions for where the menu opened, a group per plugin */
export function Actions() {
  const editor = useSlateStatic()
  const selection = useSlateSelection()
  const { actions } = usePluginRegistry()

  return (
    <>
      {contextMenuActions(editor, selection, actions).map((offered) => (
        <Group key={offered[0].action.plugin.name}>
          {offered.map(({ action, enabled }) => (
            <Item
              key={action.name}
              disabled={!enabled}
              func={() => {
                action.handler({
                  editor,
                  type: action.plugin.name,
                  options: action.plugin.options,
                  consumeFiles: consumeFilesFor(editor)
                })
              }}
            >
              {actionTitle(action)}
            </Item>
          ))}
        </Group>
      ))}
    </>
  )
}
