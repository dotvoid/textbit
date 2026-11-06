export type DebounceFunction<T extends (...args: never[]) => void> = {
  (...args: Parameters<T>): void
  force: (...args: Parameters<T>) => void
  /** Run a pending call now, if there is one */
  flush: () => void
  cancel: () => void
}

export const debounce = <T extends (...args: never[]) => void>(
  func: T,
  delay: number
): DebounceFunction<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let pending: Parameters<T> | undefined

  const debouncedFn = (...args: Parameters<T>) => {
    clearTimeout(timeoutId)
    pending = args
    timeoutId = setTimeout(() => {
      pending = undefined
      func(...args)
    }, delay)
  }

  // Force immediate execution with provided args
  debouncedFn.force = (...args: Parameters<T>) => {
    clearTimeout(timeoutId)
    pending = undefined
    func(...args)
  }

  debouncedFn.flush = () => {
    if (pending) {
      debouncedFn.force(...pending)
    }
  }

  // Cancel pending execution
  debouncedFn.cancel = () => {
    clearTimeout(timeoutId)
    pending = undefined
  }

  return debouncedFn
}
