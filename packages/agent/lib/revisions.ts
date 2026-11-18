import { Element, Node, type Descendant, type Editor } from 'slate'

/**
 * Revisions: a short hash of the document. A read records the hash of every
 * element under the revision it returns, so an edit made against that revision
 * can tell whether the elements it changes changed since: edits elsewhere in
 * the meantime do not stop it. The record lives in memory, with the editor;
 * an edit against a revision this process did not hand out is checked against
 * the whole document instead.
 */

const KEPT = 32
const SNAPSHOTS = new WeakMap<Editor, Map<string, Map<string, string>>>()

export function revisionOf(document: Descendant[]): string {
  return hash(JSON.stringify(document))
}

/** Record the element hashes of the editor's current revision, and return it */
export function recordRevision(editor: Editor): string {
  const revision = revisionOf(editor.children)
  const snapshots = SNAPSHOTS.get(editor) ?? new Map<string, Map<string, string>>()
  SNAPSHOTS.set(editor, snapshots)

  if (!snapshots.has(revision)) {
    snapshots.set(revision, elementHashes(editor.children))
    while (snapshots.size > KEPT) {
      snapshots.delete(snapshots.keys().next().value!)
    }
  }
  return revision
}

/**
 * The ids among `ids` whose element changed since `revision`, or null when
 * the revision is not known here
 */
export function changedSince(editor: Editor, revision: string, ids: string[]): string[] | null {
  const snapshot = SNAPSHOTS.get(editor)?.get(revision)
  if (!snapshot) {
    return null
  }
  const now = elementHashes(editor.children)
  return ids.filter((id) => snapshot.get(id) !== now.get(id))
}

function elementHashes(document: Descendant[]): Map<string, string> {
  const hashes = new Map<string, string>()
  for (const [node] of Node.nodes({ children: document } as unknown as Node)) {
    if (Element.isElement(node) && typeof node.id === 'string') {
      hashes.set(node.id, hash(JSON.stringify(node)))
    }
  }
  return hashes
}

/** FNV-1a, 32 bits, as eight base-36 characters at most */
function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
