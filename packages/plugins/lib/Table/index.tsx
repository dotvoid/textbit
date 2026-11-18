import type { TBComponentProps, TBOwnElementComponentProps, TBPlugin } from '@dotvoid/textbit'
import {
  TableIcon,
  RowAboveIcon,
  RowBelowIcon,
  DeleteRowIcon,
  ColLeftIcon,
  ColRightIcon,
  DeleteColIcon
} from '../shared/icons'
import { Table as TableDefinition, TYPE, type TableOptions } from './definition'

export type { TableOptions, TableAction } from './definition'

/**
 * A simple table of text cells. Tab and Shift+Tab move between cells; Tab in
 * the last cell adds a row.
 */
export const Table = (options: TableOptions = {}): TBPlugin => ({
  ...TableDefinition(options),
  view: {
    components: {
      [TYPE]: {
        component: ({ children }: TBComponentProps) => (
          <table className='tb-table'><tbody>{children}</tbody></table>
        )
      },
      // Rows and cells render the <tr> and <td> themselves: a wrapping <div> is
      // not allowed inside a table
      [`${TYPE}/row`]: {
        asOwnElement: true,
        component: ({ children, attributes }: TBOwnElementComponentProps<HTMLTableRowElement>) => (
          <tr {...attributes} className='tb-table-row'>{children}</tr>
        )
      },
      [`${TYPE}/row/cell`]: {
        asOwnElement: true,
        component: ({ children, attributes }: TBOwnElementComponentProps<HTMLTableCellElement>) => (
          <td {...attributes} className='tb-table-cell'>{children}</td>
        )
      }
    },
    tools: {
      'insert': () => <TableIcon />,
      'row-above': () => <RowAboveIcon />,
      'row-below': () => <RowBelowIcon />,
      'delete-row': () => <DeleteRowIcon />,
      'column-left': () => <ColLeftIcon />,
      'column-right': () => <ColRightIcon />,
      'delete-column': () => <DeleteColIcon />
    }
  }
})
