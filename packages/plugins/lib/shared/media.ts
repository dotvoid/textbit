import type { TBActionHandlerArgs, TBConsumeFunction, TBConsumesFunction } from '@dotvoid/textbit'
import type { Element } from 'slate'

/**
 * Consume dropped or picked files by handing each to the host's upload function
 * and inserting the block it returns. Without an upload function nothing is
 * claimed: textbit never stores a file in the document itself.
 */
export function uploadConsumer<T>(options: {
  type: string
  accept: (mime: string) => boolean
  maxSize?: number
  upload?: (file: File) => Promise<T | undefined>
  build: (uploaded: T, file: File) => Element
}): { consumes: TBConsumesFunction, consume: TBConsumeFunction } | undefined {
  const { upload } = options
  if (!upload) {
    return undefined
  }

  return {
    consumes: ({ input }) => {
      if (!(input.data instanceof File)) {
        return [false]
      }
      const mime = input.data.type.split(';')[0].trim().toLowerCase()
      const fits = options.maxSize === undefined || input.data.size <= options.maxSize
      return [options.accept(mime) && fits, options.type, false]
    },
    consume: async ({ input }) => {
      const resource = Array.isArray(input) ? input[0] : input
      if (!(resource?.data instanceof File)) {
        return undefined
      }
      // undefined means the host declined, e.g. the user cancelled
      const uploaded = await upload(resource.data)
      if (uploaded === undefined) {
        return undefined
      }
      return { source: resource.source, type: options.type, data: options.build(uploaded, resource.data) }
    }
  }
}

/**
 * Open the browser's file picker and feed the chosen files to the consumers.
 * Works from menu items, which hand actions the file input API.
 */
export function pickFiles(args: TBActionHandlerArgs, accept: string): void {
  const consume = args.api?.consumeFileInputChangeEvent
  if (typeof consume !== 'function') {
    return
  }

  const input = document.createElement('input')
  input.type = 'file'
  input.accept = accept
  input.multiple = true
  input.addEventListener('change', (event) => {
    consume(args.editor, event)
  })
  input.click()
}

/** Media addresses a document may point at; anything else is not rendered */
export function safeMediaSrc(src: unknown): string | undefined {
  if (typeof src !== 'string' || src.trim() === '') {
    return undefined
  }
  try {
    const url = new URL(src, 'https://localhost')
    if (['http:', 'https:', 'blob:'].includes(url.protocol)) {
      return src
    }
    return url.protocol === 'data:' && /^data:(image|audio)\//i.test(src) ? src : undefined
  } catch {
    return undefined
  }
}
