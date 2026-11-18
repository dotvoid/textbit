import type { TBComponentProps, TBOwnElementComponentProps, TBPlugin, TBPluginDefinition, TBToolComponent } from '@dotvoid/textbit'
import { ListIcon, OrderedListIcon } from '../shared/icons'
import { ChildPlaceholder } from '../shared/ChildPlaceholder'
import * as definitions from './definition'
import { ORDERED, type ListOptions } from './definition'

export type { ListOptions } from './definition'

/** A bullet list. Use it with OrderedList to switch a list between the two. */
export const UnorderedList = (options: ListOptions = {}): TBPlugin =>
  withView(definitions.UnorderedList(options), () => <ListIcon />, options)

/** A numbered list. Use it with UnorderedList to switch a list between the two. */
export const OrderedList = (options: ListOptions = {}): TBPlugin =>
  withView(definitions.OrderedList(options), () => <OrderedListIcon />, options)

function withView(definition: TBPluginDefinition, tool: TBToolComponent, options: ListOptions): TBPlugin {
  return {
    ...definition,
    view: {
      components: {
        [definition.name]: { component: ListComponent },
        // Renders the <li> itself: a wrapping <div> is not allowed in a list
        [`${definition.name}/list-item`]: {
          asOwnElement: true,
          component: (props: TBOwnElementComponentProps<HTMLLIElement>) => (
            <ListItemComponent {...props} placeholder={options.placeholder} />
          )
        }
      },
      tools: { toggle: tool }
    }
  }
}

function ListComponent({ element, children }: TBComponentProps) {
  return element.type === ORDERED
    ? <ol className='tb-list tb-ordered-list'>{children}</ol>
    : <ul className='tb-list tb-unordered-list'>{children}</ul>
}

function ListItemComponent({ element, children, attributes, placeholder }: TBOwnElementComponentProps<HTMLLIElement> & { placeholder?: string }) {
  return (
    <li {...attributes} className='tb-list-item' style={{ position: 'relative' }}>
      <ChildPlaceholder element={element}>{placeholder}</ChildPlaceholder>
      {children}
    </li>
  )
}
