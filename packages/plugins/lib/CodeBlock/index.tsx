import type { TBComponentProps, TBPlugin } from '@dotvoid/textbit'
import { CodeBlockIcon } from '../shared/icons'
import { ChildPlaceholder } from '../shared/ChildPlaceholder'
import { CodeBlock as CodeBlockDefinition, TYPE, type CodeBlockOptions } from './definition'

export type { CodeBlockOptions } from './definition'

/** A block of preformatted code. Tab indents inside it. */
export const CodeBlock = (options: CodeBlockOptions = {}): TBPlugin => ({
  ...CodeBlockDefinition(options),
  view: {
    components: {
      [TYPE]: {
        component: ({ children }: TBComponentProps) => <div className='tb-code-block'>{children}</div>
      },
      [`${TYPE}/body`]: {
        component: ({ children, element }: TBComponentProps) => (
          <pre className='tb-code-block-body' style={{ position: 'relative', margin: 0, whiteSpace: 'pre-wrap' }}>
            <ChildPlaceholder element={element}>{options.placeholder}</ChildPlaceholder>
            <code>{children}</code>
          </pre>
        )
      }
    },
    tools: { insert: () => <CodeBlockIcon /> }
  }
})
