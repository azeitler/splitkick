import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guards the JeanZ flavor overlay (src-tauri/tauri.fork.conf.json), which is
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
  identifier: string
  app: { windows: Record<string, unknown>[] }
  bundle: {
    icon: string[]
    createUpdaterArtifacts: boolean
    macOS: { signingIdentity: string | null; providerShortName: string | null }
  }
  plugins: { updater: { endpoints: string[]; pubkey: string } }
}

describe('JeanZ fork configuration', () => {
  it('renames the app without touching the bundle identifier', () => {
    expect(resolved.productName).toBe('JeanZ')
    // The shared identifier is deliberate: JeanZ reuses the Jean app-data
    // directory, so projects, sessions and CLI logins carry over.
    expect(resolved.identifier).toBe('com.jean.desktop')
    expect(base.productName).toBe('Jean')
  })

  it('preserves the complete main-window configuration', () => {
    expect(resolved.app.windows[0]).toMatchObject({
      title: 'JeanZ',
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

  it('points the updater at the fork so JeanZ cannot replace itself with upstream Jean', () => {
    // JeanZ keeps upstream's bundle identifier, so upstream's latest.json
    // would verify against upstream's pubkey and silently install Jean over
    // JeanZ. Both halves have to move together: the endpoint and the key.
    expect(resolved.plugins.updater.endpoints).toEqual([
      'https://github.com/azeitler/jean/releases/latest/download/latest.json',
    ])
    expect(resolved.plugins.updater.pubkey).not.toBe(
      (base.plugins as { updater: { pubkey: string } }).updater.pubkey
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
