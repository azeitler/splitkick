/**
 * Where a given app version was released.
 *
 * Splitkick releases are tagged `splitkick-v<version>` in the Splitkick repo.
 * The prefix keeps them apart from upstream Jean's `v<version>` tags, which a
 * fork checkout also fetches. Older JeanZ builds (`0.1.73-z.4`) were tagged
 * `v<version>` in the same repo (renamed from azeitler/jean).
 * See docs/developer/fork-macos-builds.md.
 */

export const REPO_URL = 'https://github.com/azeitler/splitkick'
export const UPSTREAM_REPO_URL = 'https://github.com/coollabsio/jean'

const JEANZ_VERSION = /-z\.\d+$/

/** True for a pre-Splitkick JeanZ version such as `0.1.73-z.4`. */
export function isJeanzVersion(version: string): boolean {
  return JEANZ_VERSION.test(version.trim())
}

/** Git tag of this version. */
export function tagForVersion(version: string): string {
  const v = version.trim()
  return isJeanzVersion(v) ? `v${v}` : `splitkick-v${v}`
}

/** Release page of this version. */
export function releaseUrlForVersion(version: string): string {
  return `${REPO_URL}/releases/tag/${tagForVersion(version)}`
}
