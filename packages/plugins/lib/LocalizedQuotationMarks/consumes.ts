import type { TBConsumesFunction } from '@dotvoid/textbit'

export const consumes: TBConsumesFunction = ({ input }) => {
  const { data, type } = input

  if (type !== 'text/plain') {
    return [false]
  }

  if (data !== '\'' && data !== '"' && data !== '-') {
    return [false]
  }

  return [true, 'text/plain']
}
