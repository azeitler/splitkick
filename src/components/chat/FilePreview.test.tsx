import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { FilePreview } from './FilePreview'
import { useUIStore } from '@/store/ui-store'
import type { PendingFile } from '@/types/chat'

function pendingFile(relativePath: string, extra: Partial<PendingFile> = {}) {
  return {
    id: relativePath,
    relativePath,
    extension: relativePath.split('.').pop() ?? '',
    isDirectory: false,
    ...extra,
  } as PendingFile
}

describe('FilePreview HTML/SVG pills', () => {
  beforeEach(() => {
    useUIStore.getState().setViewingFilePath(null)
  })

  it('opens an attached HTML file in the file viewer preview', () => {
    render(
      <FilePreview
        files={[pendingFile('docs/report.html')]}
        onRemove={() => undefined}
        rootPath="/repo/"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Preview report.html' }))

    expect(useUIStore.getState().viewingFilePath).toBe('/repo/docs/report.html')
  })

  it('prefers the file own source root', () => {
    render(
      <FilePreview
        files={[pendingFile('chart.svg', { sourceRootPath: '/linked' })]}
        onRemove={() => undefined}
        rootPath="/repo"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Preview chart.svg' }))

    expect(useUIStore.getState().viewingFilePath).toBe('/linked/chart.svg')
  })

  it('keeps other files as plain pills', () => {
    render(
      <FilePreview
        files={[pendingFile('src/index.ts')]}
        onRemove={() => undefined}
        rootPath="/repo"
      />
    )

    expect(screen.queryByRole('button', { name: /Preview/ })).toBeNull()
    expect(screen.getByText('index.ts')).toBeInTheDocument()
  })
})
