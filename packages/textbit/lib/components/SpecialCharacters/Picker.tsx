import { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Editor, Transforms } from 'slate'
import { ReactEditor, useSlateStatic } from 'slate-react'
import { usePluginRegistry } from '../../hooks/usePluginRegistry'
import { useTextbit } from '../../hooks/useTextbit'
import {
  AdjacentBlockContext,
  SetAdjacentBlockContext,
  type AdjacentBlockState
} from '../../contexts/AdjacentBlockContext'
import { insertTextAtCaret } from '../../utils/insertTextAtCaret'
import { onOpenSpecialCharacters, SPECIAL_CHARACTERS_PLUGIN } from './open'
import { searchCharacters, type SpecialCharacter } from './search'

type Position = { x: number, y: number }

/**
 * The special characters pane. Place it inside `Textbit.Editable`; it renders
 * nothing until the `core/specialchars` plugin's `open` action runs, then shows
 * a search field and the characters near the caret. Unstyled: every part has a
 * data attribute to style, and all text comes from props.
 */
export const SpecialCharacterPicker = ({
  className,
  placeholder,
  recent = [],
  recentLabel,
  allLabel,
  emptyLabel,
  onInsert,
  'aria-label': ariaLabel = 'Special characters'
}: {
  className?: string
  placeholder?: string
  /** Recently inserted characters, most recent first. Kept by the host. */
  recent?: readonly string[]
  recentLabel?: React.ReactNode
  allLabel?: React.ReactNode
  emptyLabel?: React.ReactNode
  /** Called with each inserted character, e.g. to update `recent` */
  onInsert?: (char: string) => void
  'aria-label'?: string
}) => {
  const editor = useSlateStatic()
  const { plugins } = usePluginRegistry()
  const { readOnly } = useTextbit()
  const adjacentBlock = useContext(AdjacentBlockContext)
  const setAdjacentBlock = useContext(SetAdjacentBlockContext)

  // The open shortcut leaves the parked caret during the same keydown, before
  // this re-renders, so the value from the last render is the one to keep.
  const adjacentRef = useRef(adjacentBlock)
  useLayoutEffect(() => {
    adjacentRef.current = adjacentBlock
  }, [adjacentBlock])

  const [open, setOpen] = useState<{ position: Position, adjacent: AdjacentBlockState | null } | null>(null)

  const characters = useMemo(() => {
    const plugin = plugins.find((p) => p.name === SPECIAL_CHARACTERS_PLUGIN)
    return isCharacters(plugin?.options?.entries) ? plugin.options.entries : []
  }, [plugins])

  useEffect(() => onOpenSpecialCharacters(editor, () => {
    if (readOnly) {
      return
    }
    setOpen({ position: caretPosition(editor), adjacent: adjacentRef.current })
  }), [editor, readOnly])

  const close = useCallback((refocus: boolean) => {
    setOpen(null)
    if (refocus) {
      ReactEditor.focus(editor)
    }
  }, [editor])

  const insert = useCallback((char: string) => {
    const adjacent = open?.adjacent ?? null
    setOpen(null)

    if (!adjacent && !editor.selection) {
      Transforms.select(editor, Editor.end(editor, []))
    }
    if (insertTextAtCaret(editor, char, adjacent) && adjacent) {
      setAdjacentBlock(null)
    }

    ReactEditor.focus(editor)
    onInsert?.(char)
  }, [editor, open, onInsert, setAdjacentBlock])

  if (!open || readOnly || !characters.length) {
    return null
  }

  return createPortal(
    <Pane
      className={className}
      position={open.position}
      characters={characters}
      placeholder={placeholder}
      recent={recent}
      recentLabel={recentLabel}
      allLabel={allLabel}
      emptyLabel={emptyLabel}
      ariaLabel={ariaLabel}
      onInsert={insert}
      onClose={close}
    />,
    document.body
  )
}

function Pane({
  className,
  position,
  characters,
  placeholder,
  recent,
  recentLabel,
  allLabel,
  emptyLabel,
  ariaLabel,
  onInsert,
  onClose
}: {
  className?: string
  position: Position
  characters: readonly SpecialCharacter[]
  placeholder?: string
  recent: readonly string[]
  recentLabel?: React.ReactNode
  allLabel?: React.ReactNode
  emptyLabel?: React.ReactNode
  ariaLabel: string
  onInsert: (char: string) => void
  onClose: (refocus: boolean) => void
}) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const byChar = useMemo(() => new Map(characters.map((c) => [c.char, c])), [characters])

  // Recently used come first while nothing is searched for. Characters outside
  // the set still show, named by their code point.
  const recentShown = useMemo(() => query.trim() ? [] : recent.map((char) => byChar.get(char) ?? {
    char,
    hex: (char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0'),
    name: char,
    english: ''
  }), [query, recent, byChar])

  const results = useMemo(() => searchCharacters(characters, query), [characters, query])
  const options = useMemo(() => [...recentShown, ...results], [recentShown, results])
  const current = options[Math.min(active, options.length - 1)]

  // Place the pane below the caret, kept inside the viewport
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) {
      return
    }
    const rect = el.getBoundingClientRect()
    const gap = 8
    const left = Math.max(gap, Math.min(position.x, window.innerWidth - rect.width - gap))
    const below = position.y + gap
    const top = below + rect.height > window.innerHeight - gap
      ? Math.max(gap, position.y - rect.height - gap * 4)
      : below
    el.style.transform = `translate(${left}px, ${top}px)`
  }, [position])

  // Close on any interaction outside the pane
  useEffect(() => {
    const handle = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        onClose(false)
      }
    }
    window.addEventListener('pointerdown', handle, { capture: true })
    return () => window.removeEventListener('pointerdown', handle, { capture: true })
  }, [onClose])

  useEffect(() => {
    document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [id, active])

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((i) => Math.max(0, Math.min(options.length - 1, i + step)))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (current) {
        onInsert(current.char)
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose(true)
    }
  }

  const renderOption = (character: SpecialCharacter, index: number) => (
    <div
      key={`${index}-${character.hex}`}
      id={`${id}-${index}`}
      role='option'
      aria-selected={index === active}
      aria-label={character.name}
      title={character.name}
      data-state={index === active ? 'active' : 'inactive'}
      {...(isInvisible(character.char) ? { 'data-invisible': '' } : {})}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={() => setActive(index)}
      onClick={() => onInsert(character.char)}
    >
      {isInvisible(character.char) ? character.hex : character.char}
    </div>
  )

  return (
    <div
      ref={ref}
      role='dialog'
      aria-label={ariaLabel}
      className={className}
      data-tb-special-characters=''
      data-tb='special-characters'
      style={{ position: 'fixed', top: 0, left: 0, zIndex: 9702 }}
    >
      <input
        type='search'
        autoFocus
        value={query}
        placeholder={placeholder}
        aria-label={placeholder ?? ariaLabel}
        role='combobox'
        aria-expanded='true'
        aria-controls={`${id}-list`}
        aria-activedescendant={current ? `${id}-${options.indexOf(current)}` : undefined}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
      />
      <div id={`${id}-list`} role='listbox' aria-label={ariaLabel}>
        {recentShown.length > 0 && (
          <div role='group' data-section='recent' aria-label={typeof recentLabel === 'string' ? recentLabel : undefined}>
            {recentLabel && <div data-heading='' aria-hidden='true'>{recentLabel}</div>}
            {recentShown.map((c, i) => renderOption(c, i))}
          </div>
        )}
        {results.length > 0 && (
          <div role='group' data-section='all' aria-label={typeof allLabel === 'string' ? allLabel : undefined}>
            {allLabel && <div data-heading='' aria-hidden='true'>{allLabel}</div>}
            {results.map((c, i) => renderOption(c, recentShown.length + i))}
          </div>
        )}
      </div>
      {!options.length && emptyLabel && <div data-empty=''>{emptyLabel}</div>}
      <div data-name='' aria-hidden='true'>{current?.name}</div>
    </div>
  )
}

/** Below the caret, or below the editor when there is no caret to measure */
function caretPosition(editor: Editor): Position {
  try {
    if (editor.selection) {
      const rect = ReactEditor.toDOMRange(editor, editor.selection).getBoundingClientRect()
      if (rect.height || rect.width || rect.left || rect.top) {
        return { x: rect.left, y: rect.bottom }
      }
    }
    const rect = ReactEditor.toDOMNode(editor, editor).getBoundingClientRect()
    return { x: rect.left, y: rect.top }
  } catch {
    return { x: 0, y: 0 }
  }
}

function isInvisible(char: string): boolean {
  return /^\s$/u.test(char)
}

function isCharacters(value: unknown): value is SpecialCharacter[] {
  return Array.isArray(value) && value.every((v) =>
    typeof v === 'object' && v !== null && typeof (v as SpecialCharacter).char === 'string'
  )
}
