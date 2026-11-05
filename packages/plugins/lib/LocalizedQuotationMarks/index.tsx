import type { TBPluginDefinition } from '@dotvoid/textbit'
import { consumes } from './consumes'
import { consume } from './consume'

/**
 * Typographic quotation marks and dashes as you type, following the editor's
 * language: "..." becomes “...” in English, ”...” in Swedish, «...» in Norwegian.
 * Two hyphens become an en dash. Quotes inserted by commands, like the special
 * characters picker, are left as they are.
 */
export const LocalizedQuotationMarks = (): TBPluginDefinition => ({
  class: 'generic',
  name: 'base/localized-quotation-marks',
  consumer: {
    consumes,
    consume
  }
})
