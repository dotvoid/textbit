import type { TBComponentProps, TBOwnElementComponentProps, TBPluginDefinition } from '@dotvoid/textbit'
import { TextbitElement } from '@dotvoid/textbit'
import { Editor, Element, Node, Transforms, type NodeEntry } from 'slate'
import {
  TableIcon,
  RowAboveIcon,
  RowBelowIcon,
  DeleteRowIcon,
  ColLeftIcon,
  ColRightIcon,
  DeleteColIcon
} from '../shared/icons'
import { insertBlockAfterCaret } from '../shared/insertBlock'

const TYPE = 'base/table'
const ROW = `${TYPE}/row`
const CELL = `${TYPE}/row/cell`

type TableAction = 'insert' | 'row-above' | 'row-below' | 'delete-row' | 'column-left' | 'column-right' | 'delete-column'

export type TableOptions = {
  /** Size of a new table. Default: 2 by 2. */
  rows?: number
  columns?: number
  /** Action names in menus and for screen readers, e.g. translations */
  titles?: Partial<Record<TableAction, string>>
}

const TITLES: Record<TableAction, string> = {
  'insert': 'Table',
  'row-above': 'Insert row above',
  'row-below': 'Insert row below',
  'delete-row': 'Delete row',
  'column-left': 'Insert column left',
  'column-right': 'Insert column right',
  'delete-column': 'Delete column'
}

/**
 * A simple table of text cells. Tab and Shift+Tab move between cells; Tab in
 * the last cell adds a row.
 */
export const Table = (options: TableOptions = {}): TBPluginDefinition => {
  const title = (action: TableAction) => options.titles?.[action] ?? TITLES[action]
  const inTable = (element: Element, innerElement?: Element): [boolean, boolean, boolean] => {
    const target = innerElement ?? element
    const visible = [TYPE, ROW, CELL].includes(target.type)
    return [visible, visible, false]
  }

  return {
    class: 'block',
    name: TYPE,
    actions: [
      {
        name: 'insert',
        title: title('insert'),
        tool: () => <TableIcon />,
        visibility: (element) => [true, true, element.type === TYPE],
        handler: ({ editor }) => {
          const columns = Math.max(1, options.columns ?? 2)
          insertBlockAfterCaret(editor, {
            id: crypto.randomUUID(),
            class: 'block',
            type: TYPE,
            children: Array.from({ length: Math.max(1, options.rows ?? 2) }, () => emptyRow(columns))
          })
        }
      },
      tableAction('row-above', title('row-above'), () => <RowAboveIcon />, inTable, (editor, cell) => {
        Transforms.insertNodes(editor, emptyRow(cell.columns), { at: [...cell.tablePath, cell.row] })
      }),
      tableAction('row-below', title('row-below'), () => <RowBelowIcon />, inTable, (editor, cell) => {
        Transforms.insertNodes(editor, emptyRow(cell.columns), { at: [...cell.tablePath, cell.row + 1] })
      }),
      tableAction('delete-row', title('delete-row'), () => <DeleteRowIcon />, inTable, (editor, cell) => {
        if (cell.rows > 1) {
          Transforms.removeNodes(editor, { at: [...cell.tablePath, cell.row] })
        }
      }),
      tableAction('column-left', title('column-left'), () => <ColLeftIcon />, inTable, (editor, cell) => {
        insertColumn(editor, cell, cell.column)
      }),
      tableAction('column-right', title('column-right'), () => <ColRightIcon />, inTable, (editor, cell) => {
        insertColumn(editor, cell, cell.column + 1)
      }),
      tableAction('delete-column', title('delete-column'), () => <DeleteColIcon />, inTable, (editor, cell) => {
        if (cell.columns <= 1) {
          return
        }
        Editor.withoutNormalizing(editor, () => {
          for (let row = cell.rows - 1; row >= 0; row--) {
            Transforms.removeNodes(editor, { at: [...cell.tablePath, row, cell.column] })
          }
        })
      }),
      {
        name: 'next-cell',
        hotkey: 'tab',
        when: (editor) => !!caretCell(editor),
        visibility: () => [false, false, false],
        handler: ({ editor, event }) => {
          event?.preventDefault()
          moveCell(editor, 1)
        }
      },
      {
        name: 'previous-cell',
        hotkey: 'shift+tab',
        when: (editor) => !!caretCell(editor),
        visibility: () => [false, false, false],
        handler: ({ editor, event }) => {
          event?.preventDefault()
          moveCell(editor, -1)
        }
      }
    ],
    componentEntry: {
      class: 'block',
      component: ({ children }: TBComponentProps) => (
        <table className='tb-table'><tbody>{children}</tbody></table>
      ),
      constraints: {
        normalizeNode: normalizeTable
      },
      // Rows and cells render the <tr> and <td> themselves: a wrapping <div> is
      // not allowed inside a table
      children: [{
        type: 'row',
        class: 'block',
        asOwnElement: true,
        component: ({ children, attributes }: TBOwnElementComponentProps<HTMLTableRowElement>) => (
          <tr {...attributes} className='tb-table-row'>{children}</tr>
        ),
        children: [{
          type: 'cell',
          class: 'text',
          asOwnElement: true,
          component: ({ children, attributes }: TBOwnElementComponentProps<HTMLTableCellElement>) => (
            <td {...attributes} className='tb-table-cell'>{children}</td>
          ),
          constraints: { allowBreak: false }
        }]
      }]
    }
  }
}

type Cell = {
  tablePath: number[]
  row: number
  column: number
  rows: number
  columns: number
}

function tableAction(
  name: TableAction,
  title: string,
  tool: () => React.ReactNode,
  visibility: (element: Element, innerElement?: Element) => [boolean, boolean, boolean],
  act: (editor: Editor, cell: Cell) => void
) {
  return {
    name,
    title,
    tool,
    visibility,
    handler: ({ editor }: { editor: Editor }) => {
      const cell = caretCell(editor)
      if (cell) {
        act(editor, cell)
      }
    }
  }
}

/** Where the caret is, when it is in a table cell */
function caretCell(editor: Editor): Cell | undefined {
  const { selection } = editor
  if (!selection) {
    return undefined
  }

  const [entry] = Editor.nodes(editor, {
    at: selection.anchor,
    match: (n) => Element.isElement(n) && n.type === CELL
  })
  if (!entry) {
    return undefined
  }

  const cellPath = entry[1]
  const tablePath = cellPath.slice(0, -2)
  const table = Node.get(editor, tablePath)
  const row = Node.get(editor, cellPath.slice(0, -1))
  if (!Element.isElement(table) || table.type !== TYPE || !Element.isElement(row)) {
    return undefined
  }

  return {
    tablePath,
    row: cellPath[cellPath.length - 2],
    column: cellPath[cellPath.length - 1],
    rows: table.children.length,
    columns: row.children.length
  }
}

function moveCell(editor: Editor, step: 1 | -1): void {
  const cell = caretCell(editor)
  if (!cell) {
    return
  }

  let { row, column } = cell
  column += step
  if (column >= cell.columns) {
    column = 0
    row += 1
  } else if (column < 0) {
    column = cell.columns - 1
    row -= 1
  }

  if (row < 0) {
    return
  }
  if (row >= cell.rows) {
    // Tab in the last cell adds a row
    Transforms.insertNodes(editor, emptyRow(cell.columns), { at: [...cell.tablePath, row] })
  }
  Transforms.select(editor, Editor.start(editor, [...cell.tablePath, row, column]))
}

function insertColumn(editor: Editor, cell: Cell, at: number): void {
  Editor.withoutNormalizing(editor, () => {
    for (let row = 0; row < cell.rows; row++) {
      Transforms.insertNodes(editor, emptyCell(), { at: [...cell.tablePath, row, at] })
    }
  })
}

function emptyRow(columns: number): Element {
  return {
    id: crypto.randomUUID(),
    class: 'block',
    type: ROW,
    children: Array.from({ length: columns }, emptyCell)
  }
}

function emptyCell(): Element {
  return { id: crypto.randomUUID(), class: 'text', type: CELL, children: [{ text: '' }] }
}

/** No table without rows, no row without cells, and every row as wide as the widest */
function normalizeTable(editor: Editor, [node, path]: NodeEntry): boolean | undefined {
  if (!Element.isElement(node)) {
    return undefined
  }

  if (node.children.length === 0) {
    Transforms.removeNodes(editor, { at: path })
    return true
  }

  for (const [index, child] of node.children.entries()) {
    if (TextbitElement.isElement(child) && child.class === 'block' && child.type !== ROW) {
      Transforms.setNodes(editor, { type: ROW }, { at: [...path, index] })
      return true
    }
  }

  const widths = node.children.map((row) => Element.isElement(row) ? row.children.length : 0)
  const empty = widths.indexOf(0)
  if (empty !== -1) {
    Transforms.removeNodes(editor, { at: [...path, empty] })
    return true
  }

  const widest = Math.max(...widths)
  const short = widths.findIndex((width) => width < widest)
  if (short !== -1) {
    Transforms.insertNodes(editor,
      Array.from({ length: widest - widths[short] }, emptyCell),
      { at: [...path, short, widths[short]] })
    return true
  }
  return undefined
}
