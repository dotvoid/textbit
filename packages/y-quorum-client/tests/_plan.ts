import { defineType, date, list, object, oneOf, string, text, id } from '../lib/model'

export const assignment = object({
  id: id(),
  title: text({ plugins: 'singleLine' }),
  status: oneOf(['todo', 'done']),
  description: text({ plugins: 'basic' })
})

export const plan = defineType('example/plan', {
  content: object({
    title: text({ plugins: 'singleLine' }),
    due: date({ optional: true }),
    meta: object({ slug: string(), section: string({ optional: true }) }),
    assignments: list(assignment, { key: 'id' })
  }),
  records: { 'status.changed': {} },
  history: true
})

export const paragraph = (id: string, words: string) => ({ id, type: 'core/text', class: 'text', children: [{ text: words }] })
