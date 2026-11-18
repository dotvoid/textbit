import { describe, test, expect, vi } from 'vitest'
import { createTextbitEditor } from '../lib/editor/createTextbitEditor'
import { consumeFilesFor } from '../lib/utils/consumeFiles'
import type { PluginDefinition } from '../lib/types/definition'

describe('consumeFiles, as actions get it', () => {
  test('hands the files to the consumers of the editor\'s plugins', async () => {
    const consume = vi.fn(async () => undefined)
    const plugin: PluginDefinition = {
      class: 'block',
      name: 'test/files',
      element: { class: 'block' },
      consumer: {
        consumes: ({ input }) => [input.data instanceof File, 'test/files'],
        consume
      }
    }
    const editor = createTextbitEditor({ plugins: [plugin] })
    consumeFilesFor(editor)([new File(['x'], 'a.txt', { type: 'text/plain' })])
    await vi.waitFor(() => expect(consume).toHaveBeenCalled())
  })
})
