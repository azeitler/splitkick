import { beforeEach, describe, expect, it } from 'vitest'
import { useUIStore } from '@/store/ui-store'
import type { Artifact, ArtifactVersion } from '@/types/chat'
import {
  comparableVersions,
  latestAt,
  openArtifactVersion,
  snapshotPath,
  versionLabel,
  versionsOf,
} from './artifact-versions'

const v1: ArtifactVersion = {
  version: 1,
  title: 'Report',
  snapshot: 's1.html',
  created_at: 1,
}
const v2: ArtifactVersion = { version: 2, title: 'Report', created_at: 2 }
const v3: ArtifactVersion = {
  version: 3,
  title: 'Report',
  snapshot: 's3.html',
  created_at: 5,
}
const artifact: Artifact = {
  id: 'a',
  title: 'Report',
  target: '/wt/out/report.html',
  created_at: 1,
  versions: [v1, v2, v3],
}

describe('artifact versions (#108)', () => {
  beforeEach(() => useUIStore.getState().setViewingFilePath(null))

  it('treats an item saved before versions existed as version 1', () => {
    const legacy: Artifact = {
      id: 'l',
      title: 'Old',
      target: 'https://x.dev',
      note: 'n',
      created_at: 7,
    }
    expect(versionsOf(legacy)).toEqual([
      { version: 1, title: 'Old', note: 'n', created_at: 7 },
    ])
    expect(latestAt(legacy)).toBe(7)
  })

  it('dates an artifact by its newest version', () => {
    expect(latestAt(artifact)).toBe(5)
  })

  it('builds the copy path with the folder separator', () => {
    expect(snapshotPath('/data/s/artifacts/', v1)).toBe(
      '/data/s/artifacts/s1.html'
    )
    expect(snapshotPath('C:\\data\\s\\artifacts', v1)).toBe(
      'C:\\data\\s\\artifacts\\s1.html'
    )
    expect(snapshotPath('/data', v2)).toBeNull()
    expect(snapshotPath(undefined, v1)).toBeNull()
  })

  it('labels a version so the viewer still picks the HTML preview', () => {
    expect(versionLabel(artifact, v3)).toBe('v3 · report.html')
  })

  it('compares only versions that have a copy', () => {
    expect(comparableVersions(artifact).map(v => v.version)).toEqual([1, 3])
  })

  it('opens a version copy in the file viewer', () => {
    openArtifactVersion(artifact, v1, '/data/s/artifacts')
    const state = useUIStore.getState()
    expect(state.viewingFilePath).toBe('/data/s/artifacts/s1.html')
    expect(state.viewingFileLabel).toBe('v1 · report.html')
  })
})
