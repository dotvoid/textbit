import { Toolbar, usePluginRegistry } from '@dotvoid/textbit'

/** Formatting and links for the selected text */
export const SelectionToolbar = () => {
  const { actions } = usePluginRegistry()

  return (
    <Toolbar.Root>
      <Toolbar.Group>
        {actions.filter((a) => a.plugin.class === 'leaf').map((a) => <Toolbar.Item key={a.name} action={a} />)}
      </Toolbar.Group>
      <Toolbar.Group>
        {actions.filter((a) => a.plugin.class === 'inline').map((a) => <Toolbar.Item key={a.name} action={a} />)}
      </Toolbar.Group>
    </Toolbar.Root>
  )
}
