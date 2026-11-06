import type { TBSpellingError } from '@dotvoid/textbit'

type Entry = Pick<TBSpellingError, 'level' | 'suggestions'>

// A stand-in for a real spelling service: a few known mistakes
const MISTAKES: Record<string, Entry> = {
  teh: { level: 'error', suggestions: [{ text: 'the' }] },
  recieve: { level: 'error', suggestions: [{ text: 'receive' }] },
  harbor: { level: 'suggestion', suggestions: [{ text: 'harbour', description: 'British spelling' }] },
  alot: { level: 'suggestion', suggestions: [{ text: 'a lot', description: 'Two words' }] }
}

/** Check texts the way a spelling service would, with a little latency */
export async function checkSpelling(texts: { lang: string, text: string }[]): Promise<Omit<TBSpellingError, 'id'>[][]> {
  await new Promise((resolve) => setTimeout(resolve, 150))
  return texts.map(({ text }) => [...text.matchAll(/\p{L}+/gu)]
    .filter((match) => MISTAKES[match[0].toLowerCase()])
    .map((match) => ({ text: match[0], ...MISTAKES[match[0].toLowerCase()] })))
}
