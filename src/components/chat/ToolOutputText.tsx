import { Fragment, useContext, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LocalPathLink } from '@/components/ui/markdown-link'
import { LocalPathRootContext } from '@/lib/chat-links'
import { tokenizeToolOutput } from '@/lib/tool-output-paths'
import { invoke } from '@/lib/transport'
import { useChatStore } from '@/store/chat-store'

/** Reply entry from the `check_paths` command. */
export interface CheckedPath {
  path: string
  exists: boolean
  isDir: boolean
  resolvedPath: string | null
}

/**
 * Tool output text with the paths in it as links.
 *
 * Renders into the caller's `<pre>`, so the output keeps its monospace style,
 * and the text stays exactly as it was: only paths that exist become links.
 * All candidates of one output are checked in a single `check_paths` call.
 *
 * Mount it only where the output shows (an expanded tool call): every mount
 * asks the backend.
 */
export function ToolOutputText({ text }: { text: string }) {
  const { segments, paths } = useMemo(() => tokenizeToolOutput(text), [text])
  const contextRoot = useContext(LocalPathRootContext)
  const activeWorktreePath = useChatStore(state => state.activeWorktreePath)
  const root = contextRoot || activeWorktreePath || null

  const { data } = useQuery({
    // Under `file-reference`, so the re-check at the end of a turn
    // (`useFileReferenceEvidence`) covers these too.
    queryKey: ['file-reference', 'check-paths', root, paths.join('\n')],
    enabled: paths.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: () => invoke<CheckedPath[]>('check_paths', { paths, root }),
  })

  const found = useMemo(() => {
    const map = new Map<string, CheckedPath>()
    for (const entry of data ?? []) {
      if (entry.exists && entry.resolvedPath) map.set(entry.path, entry)
    }
    return map
  }, [data])

  if (found.size === 0) return <>{text}</>

  return (
    <>
      {segments.map((segment, index) => {
        const hit = segment.path ? found.get(segment.path) : undefined
        if (!hit?.resolvedPath) {
          return <Fragment key={index}>{segment.text}</Fragment>
        }
        return (
          <LocalPathLink key={index} path={hit.resolvedPath} isDir={hit.isDir}>
            {segment.text}
          </LocalPathLink>
        )
      })}
    </>
  )
}
