/** One difference between two texts, placed in the new one */
export interface TextChange {
  /** Where it is in the new text */
  at: number
  /** What the new text has there */
  added: string
  /** What the old text had there */
  removed: string
}

const MAX_TOKENS = 2000

/**
 * The differences between two texts, by words: "teh" to "the" is one change,
 * not three letters. Whitespace counts as a word of its own, so a change keeps
 * to what changed. Texts too long to compare word by word are one change.
 */
export function diffWords(before: string, after: string): TextChange[] {
  if (before === after) {
    return []
  }
  const a = tokens(before)
  const b = tokens(after)
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    return [{ at: 0, added: after, removed: before }]
  }

  // Longest common subsequence of tokens, from the end
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const changes: TextChange[] = []
  let i = 0
  let j = 0
  let at = 0
  let current: TextChange | null = null
  const flush = () => {
    if (current && (current.added || current.removed)) {
      changes.push(current)
    }
    current = null
  }

  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush()
      at += b[j].length
      i++
      j++
    } else if (j < b.length && (i >= a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      current ??= { at, added: '', removed: '' }
      current.added += b[j]
      at += b[j].length
      j++
    } else {
      current ??= { at, added: '', removed: '' }
      current.removed += a[i]
      i++
    }
  }
  flush()
  return joined(changes, after)
}

/** Changes apart only by whitespace both texts share read as one */
function joined(changes: TextChange[], after: string): TextChange[] {
  const result: TextChange[] = []
  for (const change of changes) {
    const previous = result[result.length - 1]
    const gap = previous ? after.slice(previous.at + previous.added.length, change.at) : ''
    if (previous && /^\s+$/.test(gap)) {
      previous.added += gap + change.added
      previous.removed += gap + change.removed
    } else {
      result.push({ ...change })
    }
  }
  return result
}

function tokens(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? []
}
