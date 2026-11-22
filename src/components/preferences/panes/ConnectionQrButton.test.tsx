import { describe, expect, it } from 'vitest'
import { isPlainHttpHostName } from './ConnectionQrButton'

describe('isPlainHttpHostName', () => {
  it('flags plain HTTP to a host name', () => {
    expect(isPlainHttpHostName('http://mac.tail1234.ts.net:3456')).toBe(true)
    expect(isPlainHttpHostName('http://studio:3456')).toBe(true)
  })

  it('does not flag HTTPS, IP addresses or localhost', () => {
    expect(isPlainHttpHostName('https://mac.tail1234.ts.net')).toBe(false)
    expect(isPlainHttpHostName('http://100.64.0.1:3456')).toBe(false)
    expect(isPlainHttpHostName('http://[fd7a::1]:3456')).toBe(false)
    expect(isPlainHttpHostName('http://localhost:3456')).toBe(false)
    expect(isPlainHttpHostName('not a url')).toBe(false)
  })
})
