// @vitest-environment-options { "url": "https://splitkick.example.com/" }
import { afterEach, describe, expect, it } from 'vitest'
import {
  canOpenInEditor,
  canOpenNativeApps,
  canPickLocalPaths,
  isBackendOnThisMachine,
  isNativeOpenAllowed,
  setNativeOpenAllowed,
} from './environment'

describe('environment: Web Access from another machine', () => {
  afterEach(() => setNativeOpenAllowed(false))

  it('hides host-native open although the host allows it', () => {
    // A phone or laptop on the tunnel URL: Finder would open on the host
    setNativeOpenAllowed(true)

    expect(window.location.hostname).toBe('splitkick.example.com')
    expect(isBackendOnThisMachine()).toBe(false)
    expect(isNativeOpenAllowed()).toBe(false)
    expect(canOpenNativeApps()).toBe(false)
    expect(canOpenInEditor()).toBe(false)
    expect(canPickLocalPaths()).toBe(false)
  })
})
