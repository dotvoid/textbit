import { createContext } from 'react'
import type { PluginRegistryAction } from '../../contexts/PluginRegistry/lib/types'

export const ItemContext = createContext<{
  isActive: boolean
  action?: PluginRegistryAction
}>({
  isActive: false
})
