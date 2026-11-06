import { useState } from 'react'
import { Textbit } from '@dotvoid/textbit'

/** Textbit without plugins: a plain text field, its value a string */
export const PlainTextField = () => {
  const [value, setValue] = useState('')

  return (
    <>
      <Textbit.Root value={value} onChange={setValue} placeholder='Write something…' debounce={100}>
        <Textbit.Editable aria-label='Plain text' />
      </Textbit.Root>
      <p className='demo-stats'>Value: {value ? JSON.stringify(value) : '(empty)'}</p>
    </>
  )
}
