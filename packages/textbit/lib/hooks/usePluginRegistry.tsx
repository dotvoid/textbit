import { useContext } from 'react'
import { PluginRegistryContext } from '../contexts/PluginRegistry/PluginRegistryContext'
import type { PluginRegistryProviderState } from '../contexts/PluginRegistry/lib/types'

/**
 * The registered plugins and their actions, e.g. to build a menu of every
 * action that inserts a block. Rely on `plugins` and `actions`; the rest is
 * the editor's.
 */
export function usePluginRegistry(): PluginRegistryProviderState {
  const context = useContext(PluginRegistryContext)

  if (!context) {
    throw new Error('useTextbit must be used within a PluginRegistryContextProvider')
  }

  return context
}
