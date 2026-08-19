import type { TBPluginDefinition, TBConsumesFunction, TBConsumeFunction } from '../../dist/main'

/**
 * Demo plugin: pretends to "upload" any dropped file (image or other) and
 * inserts a placeholder block on completion. The 4-second artificial delay
 * exists specifically so the upload marker is visible long enough to see
 * during `npm run dev`.
 *
 * This is example code, not shipped with the library.
 */

const UPLOAD_DELAY_MS = 4000

const consumes: TBConsumesFunction = ({ input }) => {
  // Accept any file drop. The pipe passes one Resource per file when the
  // drop event has multiple; we consume each individually (aggregate=false).
  const isFile = input.type.startsWith('image/')
    || input.type === 'application/octet-stream'
    || input.type.startsWith('text/plain')
  return [isFile, 'example/mock-upload', false]
}

const consume: TBConsumeFunction = async ({ input }) => {
  const one = Array.isArray(input) ? input[0] : input
  const label = describe(one)

  await new Promise((r) => setTimeout(r, UPLOAD_DELAY_MS))

  return {
    source: 'mock-upload',
    type: 'example/mock-upload',
    data: {
      id: crypto.randomUUID(),
      type: 'example/mock-upload',
      class: 'block',
      properties: { label },
      children: [{ text: '' }]
    }
  }
}

function describe(res: { data: unknown, type: string }): string {
  if (res.data instanceof File) return `${res.data.name} (${res.data.type || 'file'})`
  if (typeof res.data === 'string') return res.data.slice(0, 60)
  return res.type
}

export const MockUpload = (): TBPluginDefinition => ({
  class: 'block',
  name: 'example/mock-upload',
  componentEntry: {
    class: 'block',
    component: ({ element, attributes, children }) => {
      const label = (element as unknown as { properties?: { label?: string } }).properties?.label ?? 'uploaded'
      return (
        <div
          {...attributes}
          contentEditable={false}
          style={{
            border: '1px solid #ccc',
            borderRadius: 6,
            padding: '10px 14px',
            background: '#f7f7f7',
            fontFamily: 'sans-serif',
            fontSize: 14
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>📎 Mock upload</div>
          <div style={{ color: '#555' }}>{label}</div>
          {children}
        </div>
      )
    }
  },
  consumer: {
    consumes,
    consume
  }
})
