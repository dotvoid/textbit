import { Menu, usePluginRegistry } from '@dotvoid/textbit'

/** The block menu beside the text: every block action */
export const GutterMenu = () => {
  const { actions } = usePluginRegistry()
  const shown = actions.filter((a) => a.visibility && !['leaf', 'inline'].includes(a.plugin.class))

  return (
    <Menu.Root>
      <Menu.Trigger>⋮</Menu.Trigger>
      <Menu.Content>
        <Menu.Group>
          {shown.map((action) => (
            <Menu.Item key={action.name} action={action.name}>
              <Menu.Icon />
              <Menu.Label />
              <Menu.Hotkey />
            </Menu.Item>
          ))}
        </Menu.Group>
      </Menu.Content>
    </Menu.Root>
  )
}
