import { useContext } from 'react'
import { TextbitContext, type TextbitState } from '../contexts/TextbitContext'

/**
 * The editor's options and state: read-only or not, language, labels, word
 * counts and more. Inside `Textbit.Root`.
 *
 * ```tsx
 * const { stats } = useTextbit()
 * return <span>{stats.short.words} words</span>
 * ```
 */
export const useTextbit = (): TextbitState => {
  const context = useContext(TextbitContext)

  if (!context) {
    throw new Error('useTextbit must be used within a TextbitProvider')
  }

  return context
}
