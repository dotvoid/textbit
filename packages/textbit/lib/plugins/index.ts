import { Text } from './Text'
import { Navigation } from './Navigation'
import { NonBreakingSpace } from './NonBreakingSpace'
import { FocusToolbar } from './FocusToolbar'


/**
 * Core's plain paragraph plugin (`base/text`), as plugin functions: what an
 * editor gets without plugins of its own, enough for a simple text field. Core
 * also falls back on `base/text` when it needs a new text block, e.g. on Enter.
 * Add it to plugins of your own to keep that paragraph, unless one of them
 * replaces it, as `Text` of `@dotvoid/textbit-plugins` does.
 *
 * ```ts
 * plugins={[...Textbit.Plugins.map((plugin) => plugin()), MyFactbox()]}
 * ```
 */
export const StandardPlugins = [
  Text
]

export const basePlugins = [
  Navigation,
  NonBreakingSpace,
  FocusToolbar
]
