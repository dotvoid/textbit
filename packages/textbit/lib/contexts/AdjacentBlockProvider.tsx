import {
  AdjacentBlockContext,
  SetAdjacentBlockContext,
  type AdjacentBlockState
} from './AdjacentBlockContext'

export function AdjacentBlockProvider({ value, setValue, children }: {
  value: AdjacentBlockState | null
  setValue: (state: AdjacentBlockState | null) => void
  children: React.ReactNode
}) {
  return (
    <AdjacentBlockContext.Provider value={value}>
      <SetAdjacentBlockContext.Provider value={setValue}>
        {children}
      </SetAdjacentBlockContext.Provider>
    </AdjacentBlockContext.Provider>
  )
}
