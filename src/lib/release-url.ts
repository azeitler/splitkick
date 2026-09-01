/**
 * Where a given app version was released.
 *
 * JeanZ builds are the upstream version plus this fork's own patch suffix
 * (0.1.73-z.4). They are tagged in the fork, and upstream has no tag for them,
 * so linking every version at upstream would 404 on every JeanZ build.
 * See docs/developer/fork-macos-builds.md.
 */

export const UPSTREAM_REPO_URL = 'https://github.com/coollabsio/jean'
export const FORK_REPO_URL = 'https://github.com/azeitler/jean'

const FORK_VERSION = /-z\.\d+$/

/** True for a JeanZ version such as `0.1.73-z.4`. */
export function isForkVersion(version: string): boolean {
  return FORK_VERSION.test(version.trim())
}

/** Repository that tagged this version. */
export function repoUrlForVersion(version: string): string {
  return isForkVersion(version) ? FORK_REPO_URL : UPSTREAM_REPO_URL
}

/** Release page of this version. */
export function releaseUrlForVersion(version: string): string {
  return `${repoUrlForVersion(version)}/releases/tag/v${version.trim()}`
}
