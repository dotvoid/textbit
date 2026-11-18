import type { ComponentProps } from '../../types'

/** An element's content as it is, for an element whose plugin has no view */
export function PlainContent({ children }: ComponentProps) {
  return <>{children}</>
}
