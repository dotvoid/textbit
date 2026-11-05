const allowedProtocols = ['http:', 'https:', 'tel:', 'mailto:']

export function sanitizeLink(link: string): string {
  const trimmed = link.trim()
  if (trimmed === '') {
    return ''
  }

  try {
    const url = new URL(trimmed)
    return allowedProtocols.includes(url.protocol) ? trimmed : ''
  } catch {
    // No absolute scheme, treat as a safe relative URL
    return trimmed
  }
}

export function isValidLink(link: string, enforceProtocol: boolean = false): boolean {
  if (typeof link !== 'string') {
    return false
  }

  const sanitizedLink = sanitizeLink(link)
  if (sanitizedLink === '') {
    return false
  }

  try {
    const url = new URL(sanitizedLink)
    return allowedProtocols.includes(url.protocol)
  } catch {
    if (enforceProtocol) {
      return false
    }
  }

  try {
    const url = new URL(sanitizedLink, 'https://localhost')
    return url.protocol === 'https:'
  } catch {
    return false
  }
}
