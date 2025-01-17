import { Editor, Element } from 'slate'
import { type Plugin } from '../../../types'
import type { PluginRegistryComponent } from '../../../components/PluginRegistry/lib/types'

// type NormalizerFunc = (editor: Editor, entry: NodeEntry) => true | void
// type NormalizerMap = Map<string, NormalizerFunc>

// FIXME: Code will eventully be refactored with commented out code (_ -> plugins)
export const withNormalizeNode = (editor: Editor, _: Plugin.Definition[], components: Map<string, PluginRegistryComponent>) => {
  const { normalizeNode } = editor

  editor.normalizeNode = (nodeEntry) => {
    const [node] = nodeEntry

    // Normalization constraints only supported on Elements
    if (!Element.isElement(node)) {
      return normalizeNode(nodeEntry)
    }

    const item = components.get(node.type)
    if (!item) {
      return normalizeNode(nodeEntry)
    }

    // Use component normalizer if exists
    if (typeof item.componentEntry.constraints?.normalizeNode === 'function') {
      if (true === item.componentEntry.constraints?.normalizeNode(editor, nodeEntry)) {
        return
      }
    }

    normalizeNode(nodeEntry)

    // const parent = Node.parent(editor, path)

    // if (Editor.isEditor(parent) && item.parent) {
    //     console.log(`${item.type} should be in ${item.parent.type}, but is in editor`)
    // }
    // else if (Element.isElement(parent) && item.parent?.type !== parent.type) {
    //     console.log(`${item.type} should be in ${item.parent?.type || 'editor'}, but is in ${parent.type}`)
    //     // debugger
    //     // for (const [child, childPath] of Node.children(editor, path)) {
    //     //     if (Element.isElement(child)) {
    //     //         Transforms.unwrapNodes(editor, { at: childPath })
    //     //         return
    //     //     }
    //     // }
    //     // return
    // }

    // Check to see if we still have invalid children, then remove them
    // const allowedChildren = item.component?.children?.map(c => `${item.type}/${c.type}`) || []
    // for (const [child, childPath] of Node.children(editor, path)) {
    //     if (Element.isElement(child) && !allowedChildren.includes(child.type)) {
    //         console.warn(`${item.type} contains ${child.type} but only allows ${allowedChildren.join(', ')}`)
    //     }
    // }

    // Check constraints and handle them
    // const constraints = componentConstraints(item.component)

    // if (constraints.maxElements > 0) {

    // }
    // else if (constraints.minElements > 0) {

    // }
    // else if (constraints.maxLength > 0) {

    // }
    // else {
    //     return normalizeNode(entry)
    // }

    // Normalization supported on Elements only as of now. If supported on
    // leafs, who should handle a leaf with formats e.g "core/bold, core/italic"?
    // if (Element.isElement(node)) {
    //     const eventHandler = normalizeHandlers.get(node.type)
    //     if (eventHandler && true === eventHandler(editor, entry)) {
    //         // If eventHandler returns true, it has handled it
    //         return
    //     }
    // }
  }

  return editor
}

// function addNormalizerForComponent(componentType: string, normalizers: NormalizerMap, normalizer: NormalizerFunc, entry: Plugin.ComponentEntry) {
//   normalizers.set(componentType, normalizer)

// As for now we only support normalization to be handled by the plugin
// (i.e the top component). If child components should have support for
// normalization they should probably have their own event handlers, not
// share with the plugin as below.

// if (!Array.isArray(component?.children)) {
//     return
// }

// component.children.forEach(childComponent => {
//     addNormalizerForComponent(
//         `${componentType}/${childComponent.type}`,
//         normalizers,
//         normalizer,
//         childComponent
//     )
// })
// }
