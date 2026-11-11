import { describe, expect, it } from 'vitest'
import { formatUsagePair } from './usage-pair'

describe('formatUsagePair (#126)', () => {
  it('shows both windows when both are known', () => {
    expect(formatUsagePair(12.4, 93)).toBe('12|93%')
  })

  it('leaves out a window the account does not have', () => {
    expect(formatUsagePair(null, 93)).toBe('93%')
    expect(formatUsagePair(40, undefined)).toBe('40%')
  })

  it('says -- only when nothing is known', () => {
    expect(formatUsagePair(null, null)).toBe('--')
  })
})
