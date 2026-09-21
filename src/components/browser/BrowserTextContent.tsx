import { memo, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Markdown } from '@/components/ui/markdown'
import { LocalPathRootContext, resolveLocalPath } from '@/lib/chat-links'
import {
  getDirname,
  isMarkdownFile,
  splitFileRefSuffix,
} from '@/lib/path-utils'
import { invoke } from '@/lib/transport'
import { useBrowserStore } from '@/store/browser-store'

interface BrowserTextContentProps {
  tabId: string
  /** `file://` URL of the text file this tab shows. */
  url: string
}

/**
 * A text file in the browser pane, rendered by React rather than by the web
 * view.
 *
 * The web view is the wrong renderer for text twice over: it shows a Markdown
 * file as its own source, and a `file://` text response carries no charset, so
 * WebKit falls back to Latin-1 and an em dash becomes mojibake. Reading the
 * file over `read_file_content` and rendering it here fixes both, and gives
 * the document Jean's own Markdown: GFM tables, code blocks with a copy
 * button, and links that `MarkdownLink` routes.
 *
 * `BrowserTabContent` decides which of the two renders a tab, so no web view
 * exists for this tab and this DOM stays visible.
 */
export const BrowserTextContent = memo(function BrowserTextContent({
  tabId,
  url,
}: BrowserTextContentProps) {
  const [content, setContent] = useState<string | null>(null)
  // The pane draws the message over this area; keep the spinner out of it.
  const [failed, setFailed] = useState(false)
  const path = resolveLocalPath(splitFileRefSuffix(url)[0])
  // Reload has no `browser_reload` to call here; the store bumps this instead.
  const reloadNonce = useBrowserStore(state => {
    for (const list of Object.values(state.tabs)) {
      const tab = list.find(t => t.id === tabId)
      if (tab) return tab.reloadNonce ?? 0
    }
    return 0
  })

  useEffect(() => {
    const signal = { cancelled: false }
    const store = useBrowserStore.getState()
    if (!path) {
      setFailed(true)
      store.setTabLoading(tabId, false)
      store.setTabError(tabId, `Not a local file: ${url}`)
      return
    }
    setContent(null)
    setFailed(false)
    store.setTabLoading(tabId, true)
    store.setTabError(tabId, null)
    store.setRequestedUrl(tabId, null)

    invoke<string>('read_file_content', { path })
      .then(fileContent => {
        if (signal.cancelled) return
        setContent(fileContent)
        const s = useBrowserStore.getState()
        s.setTabLoading(tabId, false)
        s.setTabError(tabId, null)
        s.setLastLoadedUrl(tabId, url)
      })
      .catch(error => {
        if (signal.cancelled) return
        setFailed(true)
        const s = useBrowserStore.getState()
        s.setTabLoading(tabId, false)
        s.setTabError(
          tabId,
          error instanceof Error ? error.message : `${error}`
        )
      })

    return () => {
      signal.cancelled = true
    }
  }, [tabId, url, path, reloadNonce])

  if (content === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        {!failed && (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        )}
      </div>
    )
  }

  return (
    <div className="h-full w-full overflow-auto bg-background select-text cursor-text">
      {isMarkdownFile(path ?? url) ? (
        // Relative links and images resolve next to the file, not against the
        // worktree root — the document has no idea where it is opened from.
        <LocalPathRootContext.Provider value={path ? getDirname(path) : null}>
          <div className="px-5 py-4">
            <Markdown className="text-sm">{content}</Markdown>
          </div>
        </LocalPathRootContext.Provider>
      ) : (
        <pre className="px-5 py-4 font-mono text-xs whitespace-pre-wrap break-words">
          {content}
        </pre>
      )}
    </div>
  )
})
