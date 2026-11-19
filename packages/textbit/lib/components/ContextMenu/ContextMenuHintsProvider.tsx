import { useCallback, useReducer, useState, type PropsWithChildren } from 'react'
import { ContextMenuHintsContext, type ContextMenuHintsProviderState, initialState } from './ContextMenuHintsContext'

type Hints = Pick<ContextMenuHintsProviderState, 'menu' | 'spelling'>

const reducer = (state: Hints, { menu, spelling }: Partial<Hints>): Hints => ({ ...state, menu, spelling })

export function ContextMenuHintsProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(reducer, { menu: initialState.menu, spelling: initialState.spelling })
  const [hostMenus, setHostMenus] = useState(0)

  const registerHostMenu = useCallback(() => {
    setHostMenus((n) => n + 1)
    return () => setHostMenus((n) => n - 1)
  }, [])

  const value = { ...state, dispatch, hostMenus, registerHostMenu }

  return (
    <ContextMenuHintsContext.Provider value={value}>
      {children}
    </ContextMenuHintsContext.Provider>
  )
}
