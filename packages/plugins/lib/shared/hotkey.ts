/** An option's shortcut: a replacement, `false` to remove it, or the default */
export function hotkeyOption(option: string | false | undefined, fallback?: string): string | undefined {
  return option === false ? undefined : option ?? fallback
}
