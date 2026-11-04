import { describe, it, expect } from 'vitest'
import { normalizeWhitespace } from '../lib/utils/normalizeWhitespace'

const NBSP = String.fromCharCode(0xa0)

describe('normalizeWhitespace', () => {
  it('returns an empty string unchanged', () => {
    expect(normalizeWhitespace('')).toBe('')
  })

  it('collapses multiple regular spaces to a single space', () => {
    expect(normalizeWhitespace('a   b')).toBe('a b')
  })

  it('turns line breaks and tabs into a single space', () => {
    expect(normalizeWhitespace('a\nb')).toBe('a b')
    expect(normalizeWhitespace('a\r\nb')).toBe('a b')
    expect(normalizeWhitespace('a\tb')).toBe('a b')
    expect(normalizeWhitespace('a\n\tb')).toBe('a b')
  })

  it('keeps a lone non-breaking space', () => {
    expect(normalizeWhitespace(`1${NBSP}000`)).toBe(`1${NBSP}000`)
  })

  it('collapses multiple non-breaking spaces to a single non-breaking space', () => {
    expect(normalizeWhitespace(`1${NBSP}${NBSP}${NBSP}000`)).toBe(`1${NBSP}000`)
  })

  it('collapses a mixed run of regular and non-breaking spaces to a single non-breaking space', () => {
    expect(normalizeWhitespace(`1 ${NBSP} 000`)).toBe(`1${NBSP}000`)
    expect(normalizeWhitespace(`1\t${NBSP}\n000`)).toBe(`1${NBSP}000`)
  })
})
