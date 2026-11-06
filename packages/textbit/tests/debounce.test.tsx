import { describe, test, expect, vi, afterEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { Node, Transforms, type Descendant, type Editor } from 'slate'
import { useSlateStatic } from 'slate-react'
import { debounce } from '../lib/utils/debounce'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'

afterEach(() => {
  vi.useRealTimers()
})

describe('debounce', () => {
  test('flush runs a pending call now, once, with its arguments', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced('a')
    debounced('b')
    debounced.flush()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('b')

    vi.advanceTimersByTime(200)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test('flush with nothing pending does nothing, nor after cancel', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced.flush()
    debounced('a')
    debounced.cancel()
    debounced.flush()
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('an editor unmounted with a change still waiting', () => {
  test('delivers the change as it unmounts, not after it is gone', async () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    let editor: Editor | undefined
    function Capture() {
      editor = useSlateStatic()
      return null
    }
    const value: Descendant[] = [{ id: 'a', type: 'base/text', class: 'text', properties: {}, children: [{ text: 'Hello' }] } as Descendant]
    const { unmount } = render(
      <TextbitRoot value={value} onChange={onChange} debounce={1000}>
        <TextbitEditable><Capture /></TextbitEditable>
      </TextbitRoot>
    )

    act(() => Transforms.insertText(editor!, ' world', { at: { path: [0, 0], offset: 5 } }))
    // Slate reports a change in a microtask
    await act(async () => {})
    expect(onChange).not.toHaveBeenCalled()

    unmount()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(Node.string((onChange.mock.calls[0][0] as Descendant[])[0])).toBe('Hello world')

    vi.advanceTimersByTime(2000)
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
