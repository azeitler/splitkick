import { useCallback, useEffect, useEffectEvent, useRef } from 'react'
import { useUIStore } from '@/store/ui-store'
import { ChevronUp, ChevronDown, X } from 'lucide-react'

interface ChatSearchBarProps {
  /** Session whose transcript is rendered. Find-bar state is per session. */
  sessionId: string
  scrollContainerRef: React.RefObject<HTMLElement | null>
}

interface MatchInfo {
  node: Text
  index: number
  length: number
}

/**
 * Stable identity of a match across re-renders: the message it is in and its
 * occurrence within that message. Text nodes are replaced when React
 * re-renders, and older messages prepend on load-more, so neither the node
 * nor the global index survives a re-scan.
 */
interface MatchAnchor {
  messageId: string
  occurrence: number
}

const QUERY_DEBOUNCE_MS = 150
const RESCAN_THROTTLE_MS = 150

function rangeFromMatch(m: MatchInfo): Range | null {
  try {
    const range = new Range()
    range.setStart(m.node, m.index)
    range.setEnd(m.node, m.index + m.length)
    return range
  } catch {
    // DOM may have changed since match was found (React re-render)
    return null
  }
}

function anchorsFor(found: MatchInfo[]): MatchAnchor[] {
  const counts = new Map<string, number>()
  return found.map(m => {
    const messageId =
      m.node.parentElement
        ?.closest('[data-message-anchor-id]')
        ?.getAttribute('data-message-anchor-id') ?? ''
    const occurrence = counts.get(messageId) ?? 0
    counts.set(messageId, occurrence + 1)
    return { messageId, occurrence }
  })
}

/** Center the match itself (not its parent element) in the chat viewport. */
function revealRange(range: Range, container: HTMLElement) {
  const node = range.startContainer
  const el = node instanceof Element ? node : node.parentElement
  // Horizontal reveal for wide code blocks; vertical is corrected below.
  el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  if (typeof range.getBoundingClientRect !== 'function') return
  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return
  const box = container.getBoundingClientRect()
  container.scrollTop += rect.top + rect.height / 2 - (box.top + box.height / 2)
}

function focusAndSelect(input: HTMLInputElement | null) {
  // preventScroll: focusing must never move the chat away from the match.
  input?.focus({ preventScroll: true })
  input?.select()
}

export function ChatSearchBar({
  sessionId,
  scrollContainerRef,
}: ChatSearchBarProps) {
  const search = useUIStore(s => s.chatSearchBySession[sessionId])
  const open = !!search
  const query = search?.query ?? ''
  const activeIndex = search?.activeIndex ?? 0
  const matchCount = search?.matchCount ?? 0

  const inputRef = useRef<HTMLInputElement>(null)
  const matchesRef = useRef<MatchInfo[]>([])
  const anchorRef = useRef<MatchAnchor | null>(null)
  // Returning to a session with an open bar: show its stored match once,
  // as soon as the transcript has rendered it.
  const pendingRestoreRef = useRef(
    search && search.query ? search.activeIndex : null
  )

  const supportsHighlightAPI = typeof CSS !== 'undefined' && 'highlights' in CSS

  const clearHighlights = useCallback(() => {
    if (!supportsHighlightAPI) return
    CSS.highlights.delete('chat-search')
    CSS.highlights.delete('chat-search-active')
  }, [supportsHighlightAPI])

  const showMatch = useCallback(
    (index: number, reveal: boolean) => {
      const match = matchesRef.current[index]
      const range = match ? rangeFromMatch(match) : null
      if (!range) return
      if (supportsHighlightAPI) {
        CSS.highlights.set('chat-search-active', new Highlight(range))
      }
      const container = scrollContainerRef.current
      if (reveal && container) revealRange(range, container)
    },
    [scrollContainerRef, supportsHighlightAPI]
  )

  /**
   * - `query`: the query changed → go to the first match.
   * - `rescan`: the chat DOM changed (streaming, new messages, load-more) →
   *   refresh highlights, keep the current match, never scroll.
   */
  const performSearch = useCallback(
    (kind: 'query' | 'rescan') => {
      const state = useUIStore.getState()
      const current = state.chatSearchBySession[sessionId]
      const container = scrollContainerRef.current
      clearHighlights()
      if (!current) return

      const searchQuery = current.query
      if (!searchQuery || !container) {
        matchesRef.current = []
        anchorRef.current = null
        state.updateChatSearch(sessionId, { activeIndex: 0, matchCount: 0 })
        return
      }

      const lowerQuery = searchQuery.toLowerCase()
      const found: MatchInfo[] = []
      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            if (node.parentElement?.closest('[data-chat-search-bar]')) {
              return NodeFilter.FILTER_REJECT
            }
            return NodeFilter.FILTER_ACCEPT
          },
        }
      )
      let textNode: Text | null
      while ((textNode = walker.nextNode() as Text | null)) {
        const text = textNode.textContent?.toLowerCase() ?? ''
        let startPos = 0
        let idx: number
        while ((idx = text.indexOf(lowerQuery, startPos)) !== -1) {
          found.push({ node: textNode, index: idx, length: searchQuery.length })
          startPos = idx + 1
        }
      }
      matchesRef.current = found

      if (found.length === 0) {
        anchorRef.current = null
        // Keep the stored index while a restore waits for content to render.
        state.updateChatSearch(
          sessionId,
          pendingRestoreRef.current === null
            ? { activeIndex: 0, matchCount: 0 }
            : { matchCount: 0 }
        )
        return
      }

      const anchors = anchorsFor(found)
      const clamp = (i: number) => Math.min(Math.max(0, i), found.length - 1)
      let index: number
      let reveal = false
      if (pendingRestoreRef.current !== null) {
        index = clamp(pendingRestoreRef.current)
        pendingRestoreRef.current = null
        reveal = true
      } else if (kind === 'query') {
        index = 0
        reveal = true
      } else {
        const anchor = anchorRef.current
        const same = anchor
          ? anchors.findIndex(
              a =>
                a.messageId === anchor.messageId &&
                a.occurrence === anchor.occurrence
            )
          : -1
        index = same >= 0 ? same : clamp(current.activeIndex)
      }
      anchorRef.current = anchors[index] ?? null
      state.updateChatSearch(sessionId, {
        activeIndex: index,
        matchCount: found.length,
      })

      if (supportsHighlightAPI) {
        const allRanges = found
          .map(rangeFromMatch)
          .filter((r): r is Range => r !== null)
        if (allRanges.length > 0) {
          CSS.highlights.set('chat-search', new Highlight(...allRanges))
        }
      }
      showMatch(index, reveal)
    },
    [
      sessionId,
      scrollContainerRef,
      clearHighlights,
      showMatch,
      supportsHighlightAPI,
    ]
  )

  const navigateToMatch = useCallback(
    (index: number) => {
      const total = matchesRef.current.length
      if (total === 0) return
      const wrapped = ((index % total) + total) % total
      anchorRef.current = anchorsFor(matchesRef.current)[wrapped] ?? null
      useUIStore
        .getState()
        .updateChatSearch(sessionId, { activeIndex: wrapped })
      showMatch(wrapped, true)
    },
    [sessionId, showMatch]
  )

  const close = useCallback(() => {
    clearHighlights()
    matchesRef.current = []
    anchorRef.current = null
    pendingRestoreRef.current = null
    useUIStore.getState().closeChatSearch(sessionId)
  }, [clearHighlights, sessionId])

  // Stable event fns — always see latest performSearch/close without re-subscribing.
  const onSearch = useEffectEvent((kind: 'query' | 'rescan') => {
    performSearch(kind)
  })
  const onChatSearchToggle = useEffectEvent(() => {
    if (!open) {
      useUIStore.getState().openChatSearch(sessionId)
    } else if (document.activeElement === inputRef.current) {
      close()
    } else {
      focusAndSelect(inputRef.current)
    }
  })

  // Debounced search when the query changes (and once on open/restore).
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => onSearch('query'), QUERY_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, open])

  // Re-scan when the chat DOM changes (streaming, new messages, re-renders).
  // Throttled, not debounced: a stream mutates the DOM continuously, and a
  // re-arming debounce would never fire. A re-scan never scrolls.
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!open || !query || !container) return

    let timer: ReturnType<typeof setTimeout> | null = null
    const observer = new MutationObserver(() => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        onSearch('rescan')
      }, RESCAN_THROTTLE_MS)
    })
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    return () => {
      observer.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [open, query, scrollContainerRef])

  // Focus input when opened
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => focusAndSelect(inputRef.current))
    return () => cancelAnimationFrame(id)
  }, [open])

  // Listen for the open/toggle shortcut event
  useEffect(() => {
    const handler = () => onChatSearchToggle()
    window.addEventListener('chat-search-toggle', handler)
    return () => window.removeEventListener('chat-search-toggle', handler)
  }, [])

  // Cleanup highlights on unmount (session switch keeps the stored state)
  useEffect(() => {
    return () => {
      clearHighlights()
    }
  }, [clearHighlights])

  if (!open) return null

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation() // Prevent session from also closing
      e.nativeEvent.stopImmediatePropagation()
      close()
      return
    }

    if (e.target !== inputRef.current) return

    if ((e.key === 'Enter' && e.shiftKey) || e.key === 'ArrowUp') {
      e.preventDefault()
      navigateToMatch(activeIndex - 1)
    } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault()
      navigateToMatch(activeIndex + 1)
    }
  }

  return (
    <div
      data-chat-search-bar
      onKeyDown={handleKeyDown}
      className="absolute top-2 right-4 z-30 flex items-center gap-1 rounded-md border border-border bg-popover px-2 py-1 shadow-md"
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => {
          pendingRestoreRef.current = null
          useUIStore
            .getState()
            .updateChatSearch(sessionId, { query: e.target.value })
        }}
        placeholder="Find in chat..."
        aria-label="Find in chat"
        className="w-40 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground md:text-xs"
      />
      {query && (
        <span
          className="text-xs text-muted-foreground whitespace-nowrap"
          aria-live="polite"
        >
          {matchCount > 0 ? `${activeIndex + 1}/${matchCount}` : '0/0'}
        </span>
      )}
      <button
        type="button"
        onClick={() => navigateToMatch(activeIndex - 1)}
        disabled={matchCount === 0}
        className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
        aria-label="Previous match"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => navigateToMatch(activeIndex + 1)}
        disabled={matchCount === 0}
        className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
        aria-label="Next match"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={close}
        className="rounded p-0.5 text-muted-foreground hover:text-foreground"
        aria-label="Close search"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
