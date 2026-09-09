import type { YjsEditor } from '@slate-yjs/core'
import type * as Y from 'yjs'

/**
 * Give this editor its own copy of every remote text delta.
 *
 * `@slate-yjs/core@1.0.2` reverses the delta in place before applying it
 * (`applyDelta()` in `applyToSlate/textEvent.ts`):
 *
 *     delta.reverse().forEach(...)
 *
 * Reversing is correct - delta offsets are relative to the pre-change text, so
 * the ops have to be applied back to front. Mutating is not: Yjs computes an
 * event's delta lazily, caches it on the event, and hands the very same array
 * to every observer. Two editors bound to the same shared root in the same
 * client therefore reverse the same array twice, and the second one walks it in
 * original order while treating it as reversed - it applies the insert at
 * offset 0 instead of where it belongs, and then writes at those wrong offsets
 * back into the shared, persisted document.
 *
 * With N editors it alternates down the observer chain: first applier correct,
 * second corrupt, third correct. The originating editor skips its own change,
 * which shifts the parity of everyone after it, so which views break changes
 * with every keystroke depending on who typed it.
 *
 * Upstream is abandoned, so the copy happens here instead. As long as every
 * editor on a shared root is guarded the cached array is never reversed at all,
 * which also means any other observer of that root sees the true op order.
 */
export function withRemoteDeltaGuard<T extends YjsEditor>(editor: T): T {
  const { applyRemoteEvents } = editor

  editor.applyRemoteEvents = (events, origin) => {
    applyRemoteEvents(events.map(withOwnDelta), origin)
  }

  return editor
}

/**
 * A faithful view of `event` whose `delta` is a fresh array on every read.
 * Everything else forwards to the real event, so `instanceof Y.YTextEvent`
 * and the lazy `changes`/`delta` caches keep working.
 */
function withOwnDelta(event: Y.YEvent<Y.XmlText>): Y.YEvent<Y.XmlText> {
  return new Proxy(event, {
    get: (target, prop, receiver) => prop === 'delta'
      ? [...target.delta]
      : Reflect.get(target, prop, receiver)
  })
}
