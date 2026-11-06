import { useUIStore } from '@/store/ui-store'
import type { Artifact, ArtifactVersion } from '@/types/chat'

/** Versions oldest first. An item saved before versions existed is version 1. */
export function versionsOf(artifact: Artifact): ArtifactVersion[] {
  if (artifact.versions?.length) return artifact.versions
  return [
    {
      version: 1,
      title: artifact.title,
      note: artifact.note,
      created_at: artifact.created_at,
    },
  ]
}

/** When the artifact last changed: its newest version. */
export function latestAt(artifact: Artifact): number {
  return versionsOf(artifact).at(-1)?.created_at ?? artifact.created_at
}

/** Absolute path of a version's copy, or null when it has none. */
export function snapshotPath(
  dir: string | null | undefined,
  version: ArtifactVersion
): string | null {
  if (!dir || !version.snapshot) return null
  const separator = dir.includes('\\') ? '\\' : '/'
  return `${dir.replace(/[\\/]+$/, '')}${separator}${version.snapshot}`
}

/** File name of the target, e.g. `report.html`. */
export function targetName(artifact: Artifact): string {
  return artifact.target.split(/[\\/]/).filter(Boolean).at(-1) ?? artifact.title
}

/**
 * Name shown for a version in the file viewer, e.g. `v2 · report.html`. It
 * ends in the target's name: the viewer picks the preview from that name.
 */
export function versionLabel(
  artifact: Artifact,
  version: ArtifactVersion
): string {
  return `v${version.version} · ${targetName(artifact)}`
}

/** Open a version's copy in the file viewer. */
export function openArtifactVersion(
  artifact: Artifact,
  version: ArtifactVersion,
  dir: string | null | undefined
): void {
  const path = snapshotPath(dir, version)
  if (!path) return
  useUIStore
    .getState()
    .setViewingFilePath(path, versionLabel(artifact, version))
}

/** Versions that have a copy, so they can be opened and compared. */
export function comparableVersions(artifact: Artifact): ArtifactVersion[] {
  return versionsOf(artifact).filter(v => !!v.snapshot)
}

export const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i
