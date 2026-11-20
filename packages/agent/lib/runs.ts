import { Editor, Operation } from 'slate'
import * as Y from '@y/y'
import { sharedOf } from '@dotvoid/textbit/headless'

/**
 * Agents' edits as their own: in a shared document they reach Y.js under an
 * origin of their own, so the undo of the person at the same editor never
 * undoes them, and a run of edits can be undone as one, leaving what others
 * wrote in the meantime. In a document that is not shared, a run records its
 * operations and undoes them while nobody else has changed the document.
 */

const AGENT_ORIGINS = new WeakMap<Editor, object | symbol>()

/** Has an agent's edits on an editor go in under a given origin */
export function setAgentOrigin(editor: Editor, origin: object): void {
  AGENT_ORIGINS.set(editor, origin)
}

/** The origin of agent edits on a shared editor, set up on first use */
export function agentOrigin(editor: Editor): object | symbol | undefined {
  if (!sharedOf(editor)) {
    return undefined
  }
  let origin = AGENT_ORIGINS.get(editor)
  if (!origin) {
    origin = Symbol('textbit-agent')
    AGENT_ORIGINS.set(editor, origin)
  }
  return origin
}

/** Run agent changes on an editor, as the agent's, and send them at once */
export function asAgent(editor: Editor, change: () => void, record?: (operation: Operation) => void): void {
  const origin = agentOrigin(editor)
  const { apply } = editor
  if (record) {
    editor.apply = (operation) => {
      record(operation)
      apply(operation)
    }
  }
  try {
    const shared = sharedOf(editor)
    if (origin && shared) {
      // The binding writes to Y.js as each operation is applied: nothing to flush
      shared.withOrigin(origin, change)
    } else {
      change()
    }
  } finally {
    if (record) {
      editor.apply = apply
    }
  }
}

/** The edits of one task, from `startRun`: finished together, undone together */
export interface AgentRun {
  /** Batches applied in the run */
  readonly edits: number
  /** End the run. Its edits can still be undone. */
  finish(): void
  /**
   * Undo every edit of the run. In a shared document what others wrote in the
   * meantime stays. Otherwise it works while nobody else changed the document.
   */
  undo(): {
    /** Undone */
    ok: true
  } | {
    /** Not undone */
    ok: false
    /** Why not */
    message: string
  }
}

export interface RunRecorder {
  record(operation: Operation): void
  edited(): void
}

export function startRun(editor: Editor, onEnd: () => void): { run: AgentRun, recorder: RunRecorder } {
  const origin = agentOrigin(editor)
  const shared = sharedOf(editor)
  const manager = origin && shared
    ? new Y.UndoManager(shared.field, { trackedOrigins: new Set([origin]), captureTimeout: Number.MAX_SAFE_INTEGER })
    : undefined
  const operations: Operation[] = []
  let edits = 0
  let after: Editor['children'] | undefined
  let open = true

  const recorder: RunRecorder = {
    record: (operation) => {
      if (!manager) {
        operations.push(operation)
      }
    },
    edited: () => {
      edits++
      after = editor.children
    }
  }

  const run: AgentRun = {
    get edits() {
      return edits
    },
    finish: () => {
      if (open) {
        open = false
        onEnd()
      }
    },
    undo: () => {
      run.finish()
      if (manager) {
        while (manager.undoStack.length) {
          manager.undo()
        }
        manager.destroy()
        return { ok: true }
      }
      if (after && editor.children !== after) {
        return { ok: false, message: 'The document changed since the agent\'s edits; undo them by hand' }
      }
      Editor.withoutNormalizing(editor, () => {
        for (const operation of [...operations].reverse()) {
          editor.apply(Operation.inverse(operation))
        }
      })
      operations.length = 0
      after = editor.children
      return { ok: true }
    }
  }

  return { run, recorder }
}
