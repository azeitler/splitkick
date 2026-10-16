import { describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import CodeEditor from './code-editor'

const mocks = vi.hoisted(() => ({
  fileProps: [] as Record<string, unknown>[],
}))

vi.mock('@pierre/diffs/react', () => ({
  File: (props: Record<string, unknown>) => {
    mocks.fileProps.push(props)
    return null
  },
  EditProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@pierre/diffs/edit', () => ({ Editor: vi.fn() }))
vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: null }),
}))

function lastFileProps() {
  const props = mocks.fileProps.at(-1)
  if (!props) throw new Error('Pierre File was not rendered')
  return props as {
    file: { name: string; cacheKey: string }
    options: { disableErrorHandling?: boolean }
  }
}

describe('CodeEditor', () => {
  // Pierre drew its own error box into the shadow root, out of reach of the
  // app's error boundary and log (#42).
  it('lets Pierre render errors reach the React error boundary', () => {
    render(
      <CodeEditor value="a" fileName="index.ts" cacheKey="/repo/index.ts" />
    )

    expect(lastFileProps().options.disableErrorHandling).toBe(true)
  })

  // Pierre wants a cache key unique per file; the basename is not.
  it('keys the editor by the full path, not the basename', () => {
    render(
      <CodeEditor value="a" fileName="index.ts" cacheKey="/repo/a/index.ts" />
    )

    expect(lastFileProps().file.name).toBe('index.ts')
    expect(lastFileProps().file.cacheKey).toBe('/repo/a/index.ts')
  })
})
