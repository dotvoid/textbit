import { Text } from './Text'
import { Navigation } from './Navigation'
import { NonBreakingSpace } from './NonBreakingSpace'
import { FocusToolbar } from './FocusToolbar'


// What an editor gets without plugins of its own: a plain paragraph, enough for
// a simple text field. Core also falls back on base/text when it needs a new
// text block, e.g. on Enter or paste.
export const StandardPlugins = [
  Text
]

export const basePlugins = [
  Navigation,
  NonBreakingSpace,
  FocusToolbar
]
