import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guards the Splitkick overlay (src-tauri/tauri.fork.conf.json), which is
 * applied through `tauri build -c`. Tauri merges configs by replacing arrays,
 * so the overlay has to repeat the whole window block - the same reason
 * tauri.windows.conf.json repeats it. This test fails if a field is dropped.
 */
function readConfig(configPath: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(process.cwd(), configPath), 'utf8')
  ) as Record<string, unknown>
}

function mergeJsonConfig(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...base }

  for (const [key, value] of Object.entries(patch)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof merged[key] === 'object' &&
      merged[key] !== null &&
      !Array.isArray(merged[key])
    ) {
      merged[key] = mergeJsonConfig(
        merged[key] as Record<string, unknown>,
        value as Record<string, unknown>
      )
    } else {
      merged[key] = value
    }
  }

  return merged
}

const base = readConfig('src-tauri/tauri.conf.json')
const fork = readConfig('src-tauri/tauri.fork.conf.json')
const resolved = mergeJsonConfig(base, fork) as {
  productName: string
  mainBinaryName: string
  identifier: string
  app: { windows: Record<string, unknown>[] }
  bundle: {
    icon: string[]
    createUpdaterArtifacts: boolean
    macOS: { signingIdentity: string | null; providerShortName: string | null }
  }
  plugins: { updater: { endpoints: string[]; pubkey: string } }
}

describe('Splitkick configuration', () => {
  it('renames the app and gives it its own bundle identifier', () => {
    expect(resolved.productName).toBe('Splitkick')
    expect(resolved.mainBinaryName).toBe('Splitkick')
    // Own identifier and own data directory (jean_core::brand), so Splitkick
    // installs and runs next to Jean.
    expect(resolved.identifier).toBe('app.splitkick.desktop')
    // The base config stays byte-identical to upstream.
    expect(base.identifier).toBe('com.jean.desktop')
    expect(base.productName).toBe('Jean')
  })

  it('keeps the development build apart from the release build', () => {
    const dev = readConfig('src-tauri/tauri.conf.dev.json')
    expect(dev.identifier).toBe('app.splitkick.desktop.dev')
    expect(dev.productName).toBe('Splitkick')
  })

  it('preserves the complete main-window configuration', () => {
    expect(resolved.app.windows[0]).toMatchObject({
      title: 'Splitkick',
      width: 800,
      height: 600,
      minWidth: 1000,
      minHeight: 700,
      center: true,
      decorations: true,
      titleBarStyle: 'Overlay',
      hiddenTitle: true,
      shadow: true,
      dragDropEnabled: false,
      transparent: false,
      windowEffects: {
        effects: [],
        radius: 0,
        state: 'active',
      },
    })
  })

  it('ships its own icon set and every file exists', () => {
    expect(
      resolved.bundle.icon.every(path => path.startsWith('icons-fork/'))
    ).toBe(true)
    for (const icon of resolved.bundle.icon) {
      expect(existsSync(join(process.cwd(), 'src-tauri', icon))).toBe(true)
    }
  })

  it('overrides the upstream signing identity so local builds work', () => {
    // The base config pins coolLabs' Developer ID, which nobody else has.
    // CI replaces "-" through the APPLE_SIGNING_IDENTITY environment variable.
    expect(resolved.bundle.macOS.signingIdentity).toBe('-')
    expect(resolved.bundle.macOS.providerShortName).toBeNull()
  })

  it('points the updater at Splitkick so it cannot replace itself with upstream Jean', () => {
    // Left unchanged, upstream's latest.json would verify against upstream's
    // pubkey and silently install Jean over Splitkick. Both halves have to
    // move together: the endpoint and the key.
    expect(resolved.plugins.updater.endpoints).toEqual([
      'https://github.com/azeitler/splitkick/releases/latest/download/latest.json',
    ])
    expect(resolved.plugins.updater.pubkey).not.toBe(
      (base.plugins as { updater: { pubkey: string } }).updater.pubkey
    )
    // Nor the JeanZ key: a JeanZ install must never accept a Splitkick build
    // (the in-place update would keep the JeanZ bundle path and data).
    expect(atob(resolved.plugins.updater.pubkey)).not.toContain(
      '47C8A67092AE7F7F'
    )
  })

  it('leaves updater artifacts off so a local build needs no signing key', () => {
    // Tauri fails the build when a pubkey is configured and the artifacts are
    // requested without TAURI_SIGNING_PRIVATE_KEY. CI turns them on with an
    // extra -c layer once the secret is present; scripts/build-fork-macos.sh
    // does not, so it keeps working on a machine that has no key.
    expect(resolved.bundle.createUpdaterArtifacts).toBe(false)
  })
})
