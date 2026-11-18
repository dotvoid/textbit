import { useReducer } from 'react'

import { addToRegistry, createRegistry } from './lib/createRegistry'

import type { PluginRegistryProviderState, PluginRegistryReducerAction } from './lib/types'
import type { PluginDefinition } from '../../types'
import { initialState, PluginRegistryContext } from './PluginRegistryContext'

/**
 * Plugin registry reducer
 * @param state
 * @param action
 * @returns
 */
const reducer = (state: PluginRegistryProviderState, message: PluginRegistryReducerAction): PluginRegistryProviderState => {
  const { action, plugin } = message

  if (action === 'delete') {
    console.warn('Deleting plugins from plugin registry not implemented')
    return state
  }

  return {
    ...state,
    ...addToRegistry(state, plugin, { verbose: state.verbose })
  }
}


// Create the context provider component
export function PluginRegistryProvider({ children, verbose, plugins }: {
  verbose: boolean
  plugins: PluginDefinition[]
  children: React.ReactNode
}) {
  // Plugins are read once, on mount. Lazy init so the registry is not
  // rebuilt (and discarded) on every render.
  const [state, dispatch] = useReducer(reducer, plugins, (initial) => ({
    ...initialState(),
    ...createRegistry(initial, { verbose })
  }))

  return (
    <PluginRegistryContext.Provider value={{ ...state, dispatch }}>
      {children}
    </PluginRegistryContext.Provider>
  )
}
