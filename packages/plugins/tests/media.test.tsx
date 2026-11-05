import { describe, test, expect, vi } from 'vitest'
import { act, fireEvent } from '@testing-library/react'
import { Editor, Node, Transforms, type Descendant, type Element } from 'slate'
import type { TBPluginDefinition, TBConsumeFunction, TBConsumesFunction } from '@dotvoid/textbit'
import { Audio, Blockquote, Image, Text, audioNode, imageNode } from '../lib'
import { renderEditor, settle } from './_editor'

const file = (name: string, type: string, size = 10) => {
  const f = new File(['x'.repeat(size)], name, { type })
  return f
}

function consumerOf(plugin: TBPluginDefinition): { consumes: TBConsumesFunction, consume: TBConsumeFunction } {
  if (!('consumer' in plugin) || !plugin.consumer) {
    throw new Error(`${plugin.name} has no consumer`)
  }
  return plugin.consumer
}

const withImage = (props: Record<string, unknown>): Descendant[] => [{
  ...imageNode({ src: '' }),
  properties: props
} as Descendant]

describe('Image', () => {
  test('without an upload function it only renders images, and offers no insert', () => {
    const plugin = Image()
    expect('consumer' in plugin && plugin.consumer).toBeFalsy()
    expect(plugin.actions![0].visibility!({ type: 'core/text' } as Element)).toEqual([false, false, false])
  })

  test('renders the image with its alternative text', () => {
    const { container } = renderEditor([Text(), Image()], withImage({ src: 'https://example.com/a.jpg', alt: 'A harbour' }))
    const img = container.querySelector('img')!
    expect(img.getAttribute('src')).toBe('https://example.com/a.jpg')
    expect(img.getAttribute('alt')).toBe('A harbour')
  })

  test('an address it should not load is not rendered', () => {
    const { container } = renderEditor([Text(), Image()], withImage({ src: 'javascript:alert(1)' }))
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Image not available')
  })

  test('the alternative text can be edited', () => {
    const { editor, container } = renderEditor([Text(), Image()], withImage({ src: 'https://example.com/a.jpg', alt: '' }))
    const input = container.querySelector('input[aria-label="Alternative text"]') as HTMLInputElement

    fireEvent.change(input, { target: { value: 'A harbour at dusk' } })
    fireEvent.blur(input)

    expect((editor.children[0] as Element).properties?.alt).toBe('A harbour at dusk')
  })

  test('files go to the upload function, and its answer becomes the image', async () => {
    const upload = vi.fn(async () => ({ src: 'https://cdn.example/1.png', width: 800, height: 600 }))
    const { consumes, consume } = consumerOf(Image({ upload }))
    const input = { source: 'drop', type: 'image/png', data: file('a.png', 'image/png') }

    expect(consumes({ input })).toEqual([true, 'core/image', false])
    const result = await consume({ input, editor: {} as Editor })

    expect(upload).toHaveBeenCalledWith(input.data)
    expect(result?.type).toBe('core/image')
    expect((result?.data as Element).properties).toEqual({ src: 'https://cdn.example/1.png', alt: '', width: 800, height: 600 })
  })

  test('declined uploads insert nothing', async () => {
    const { consume } = consumerOf(Image({ upload: async () => undefined }))
    const input = { source: 'drop', type: 'image/png', data: file('a.png', 'image/png') }
    expect(await consume({ input, editor: {} as Editor })).toBeUndefined()
  })

  test('only accepted types and sizes are claimed', () => {
    const { consumes } = consumerOf(Image({ upload: async () => undefined, maxSize: 5 }))
    const claims = (f: File) => consumes({ input: { source: 'drop', type: f.type, data: f } })[0]

    expect(claims(file('a.png', 'image/png', 3))).toBe(true)
    expect(claims(file('a.png', 'image/png', 9))).toBe(false)
    expect(claims(file('a.tiff', 'image/tiff', 3))).toBe(false)
    expect(consumes({ input: { source: 'drop', type: 'text/plain', data: 'hello' } })[0]).toBe(false)
  })

  test('the insert action opens a file picker whose files go to the consumers', () => {
    const consume = vi.fn()
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      this.dispatchEvent(new Event('change'))
    })
    const action = Image({ upload: async () => undefined }).actions![0]

    action.handler({ editor: {} as Editor, type: 'core/image', api: { consumeFileInputChangeEvent: consume } })

    expect(consume).toHaveBeenCalled()
    click.mockRestore()
  })
})

describe('Audio', () => {
  test('renders a player with its title, and keeps unsafe addresses out', () => {
    const doc = (src: string) => [{ ...audioNode({ src, title: 'Interview' }) } as Descendant]

    const safe = renderEditor([Text(), Audio()], doc('https://example.com/a.mp3'))
    const audio = safe.container.querySelector('audio')!
    expect(audio.getAttribute('src')).toBe('https://example.com/a.mp3')
    expect(audio.getAttribute('aria-label')).toBe('Interview')
    safe.unmount()

    const unsafe = renderEditor([Text(), Audio()], doc('javascript:alert(1)'))
    expect(unsafe.container.querySelector('audio')).toBeNull()
  })

  test('an uploaded file is titled by its name unless the host names it', async () => {
    const { consume } = consumerOf(Audio({ upload: async () => ({ src: 'https://cdn.example/a.mp3' }) }))
    const result = await consume({ input: { source: 'drop', type: 'audio/mpeg', data: file('talk.mp3', 'audio/mpeg') }, editor: {} as Editor })
    expect((result?.data as Element).properties).toEqual({ src: 'https://cdn.example/a.mp3', title: 'talk.mp3' })
  })
})

describe('Blockquote', () => {
  test('inserts a quote with a source, and moves into the quote', async () => {
    const { editor, container, run } = renderEditor([Text(), Blockquote()], 'Hello')
    act(() => Transforms.select(editor, Editor.end(editor, [0])))

    run('core/blockquote/insert')
    await settle()

    expect((editor.children[1] as Element).children.map((c) => (c as Element).type))
      .toEqual(['core/blockquote/body', 'core/blockquote/citation'])
    expect(editor.selection?.anchor.path.slice(0, 2)).toEqual([1, 0])
    expect(container.querySelector('figure.tb-blockquote blockquote')).not.toBeNull()
    expect(container.querySelector('figure.tb-blockquote figcaption')).not.toBeNull()
  })

  test('labels can be translated, and show as hints in the empty parts', async () => {
    const { editor, container, run } = renderEditor([Text(), Blockquote({ labels: { body: 'Citat', citation: 'Källa' } })], 'Hello')
    act(() => Transforms.select(editor, Editor.end(editor, [0])))
    run('core/blockquote/insert')
    await settle()

    const hints = [...container.querySelectorAll('.tb-child-placeholder')].map((n) => n.textContent)
    expect(hints).toEqual(['Citat', 'Källa'])
    expect(Node.string(editor.children[1])).toBe('')
  })
})
