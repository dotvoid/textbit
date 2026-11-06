import { type Dispatch, type SetStateAction, createContext, type DragEvent } from 'react'
import type { DropTarget } from '../utils/dropTarget'

export type DragStateContextInterface = {
  dragOver: boolean
  /** Where a drop would go now, while something is dragged over the editor */
  offset?: DropTarget
  onDragEnter: () => void
  onDragLeave: () => void
  onDrop: (e: DragEvent) => void
  setOffset: Dispatch<SetStateAction<DropTarget | undefined>>
}

export const DragstateContext = createContext<DragStateContextInterface>({
  dragOver: false,
  onDragEnter: () => { },
  onDragLeave: () => { },
  onDrop: () => { },
  setOffset: () => { }
})
