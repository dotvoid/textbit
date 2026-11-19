// Cursors in a shared text field, through Y.js awareness. A cursor is the
// selection as relative positions, so it follows the text. With several editors
// on one document in one page, only the one in use sends: an editor without
// focus never moves or clears the person's cursor.
import * as Y from '@y/y'
import type { Awareness } from '@y/protocols/awareness'
import type { Editor, Range } from 'slate'
import { pointToRelativePosition, relativePositionToPoint } from './positions'

/** How a cursor is shared */
export interface TBCursorOptions {
  /** The awareness field of the cursor's position. Default: `'selection'`. */
  stateField?: string
  /** The awareness field of `data`. Default: `'data'`. */
  dataField?: string
  /** Whether the cursor is sent as it moves. Default: `true`. */
  autoSend?: boolean
  /** Shown to others with the cursor, e.g. `{ name, color }` */
  data?: Record<string, unknown>
}

/** Another person's cursor in this editor's field */
export interface TBRemoteCursor {
  /** Their awareness client id */
  clientId: number
  /** What they share with it, e.g. `{ name, color }` */
  data: Record<string, unknown> | undefined
  /** Where it is in this editor */
  range: Range
}

interface CursorState {
  anchor: number[]
  focus: number[]
}

/**
 * Shares an editor's cursor through awareness while `isActive` says it is in
 * use. Returns a function that stops sharing.
 */
export function withSharedCursor(
  editor: Editor,
  awareness: Awareness,
  options: TBCursorOptions = {},
  isActive: () => boolean = () => true
): () => void {
  const stateField = options.stateField ?? 'selection'
  const dataField = options.dataField ?? 'data'
  if (options.data) {
    awareness.setLocalStateField(dataField, options.data)
  }
  let sent = ''
  const { onChange } = editor
  editor.onChange = (change) => {
    onChange(change)
    if (options.autoSend !== false && isActive()) {
      sendCursor(editor, awareness, stateField)
    }
  }

  function sendCursor(target: Editor, to: Awareness, field: string) {
    const state = cursorState(target, target.selection)
    const json = JSON.stringify(state)
    if (json !== sent) {
      sent = json
      to.setLocalStateField(field, state)
    }
  }

  return () => {
    editor.onChange = onChange
  }
}

/** The editor's selection as it is shared: relative positions as bytes */
export function cursorState(editor: Editor, selection: Range | null): CursorState | null {
  if (!selection) {
    return null
  }
  const anchor = pointToRelativePosition(editor, selection.anchor)
  const focus = pointToRelativePosition(editor, selection.focus)
  if (!anchor || !focus) {
    return null
  }
  return {
    anchor: Array.from(Y.encodeRelativePosition(anchor)),
    focus: Array.from(Y.encodeRelativePosition(focus))
  }
}

/** The other people's cursors that are in this editor's field */
export function remoteCursors(editor: Editor, awareness: Awareness, options: TBCursorOptions = {}): TBRemoteCursor[] {
  const stateField = options.stateField ?? 'selection'
  const dataField = options.dataField ?? 'data'
  const cursors: TBRemoteCursor[] = []
  for (const [clientId, state] of awareness.getStates() as Map<number, Record<string, unknown>>) {
    if (clientId === awareness.clientID) {
      continue
    }
    const cursor = state[stateField]
    if (!isCursorState(cursor)) {
      continue
    }
    const anchor = relativePositionToPoint(editor, Y.decodeRelativePosition(Uint8Array.from(cursor.anchor)))
    const focus = relativePositionToPoint(editor, Y.decodeRelativePosition(Uint8Array.from(cursor.focus)))
    if (anchor && focus) {
      const data = state[dataField]
      cursors.push({
        clientId,
        data: typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : undefined,
        range: { anchor, focus }
      })
    }
  }
  return cursors
}

function isCursorState(value: unknown): value is CursorState {
  return typeof value === 'object' && value !== null &&
    Array.isArray((value as CursorState).anchor) && Array.isArray((value as CursorState).focus)
}
