/**
 * Normalizes whitespace in a string so it cannot break a paragraph into
 * multiple lines while preserving intentional non-breaking spaces.
 *
 * Each run of whitespace collapses to a single character:
 *   - if the run contains a non-breaking space (U+00A0), the result is a
 *     non-breaking space so grouped values like `1<nbsp>000` stay together
 *   - otherwise the result is a regular space; tabs, line breaks, form feeds,
 *     line and paragraph separators, etc. all become one regular space
 *
 * Only U+00A0 is preserved. Other specialty whitespace codepoints matched by
 * `\s` (figure space, narrow no-break space, ...) collapse to a regular space.
 */

// Non-breaking space (U+00A0). Built from its char code so the source stays
// ASCII and a regular space is never confused with a non-breaking one.
const NBSP = String.fromCharCode(0xa0)

export function normalizeWhitespace(text: string): string {
  if (!text) {
    return text
  }

  return text.replace(/\s+/g, (run) => (run.includes(NBSP) ? NBSP : ' '))
}
