/**
 * The type of a plain text block. Core creates one whenever it needs a new text
 * block: on Enter, on paste, for an empty document, and when it repairs a block
 * without a type. A plugin that renders text blocks registers this name.
 */
export const TEXT_TYPE = 'base/text'
