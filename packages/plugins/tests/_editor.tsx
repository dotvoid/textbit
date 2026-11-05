import { act, render } from '@testing-library/react'
import { useSlateStatic } from 'slate-react'
import { Editor, type Descendant } from 'slate'
import { Textbit, usePluginRegistry, type TBPluginDefinition, type TBPluginRegistryAction } from '@dotvoid/textbit'

/**
 * A real editor with the given plugins, plus a way to run any registered action
 * the way a menu or toolbar would.
 */
export function renderEditor(plugins: TBPluginDefinition[], value: Descendant[] | string = 'Hello world') {
  let editor: Editor | undefined
  let actions: TBPluginRegistryAction[] = []
  function Capture() {
    editor = useSlateStatic()
    actions = usePluginRegistry().actions
    return null
  }
  const result = render(
    <Textbit.Root value={value as Descendant[]} onChange={() => {}} plugins={plugins}>
      <Textbit.Editable aria-label='Text'><Capture /></Textbit.Editable>
    </Textbit.Root>
  )

  const run = (name: string) => {
    const action = actions.find((a) => a.name === name)
    if (!action) {
      throw new Error(`No action ${name}; have ${actions.map((a) => a.name).join(', ')}`)
    }
    act(() => {
      action.handler({ editor: editor!, type: action.plugin.name, options: action.plugin.options })
    })
  }

  return { ...result, editor: editor!, actions: () => actions, run }
}

/** Let Slate's change notification, sent in a microtask, reach React */
export async function settle() {
  await act(async () => {})
}
