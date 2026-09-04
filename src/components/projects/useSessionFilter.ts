import { useCallback, useState } from 'react'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'

/** Short enough to feel instant, long enough to skip a burst of keystrokes. */
const FILTER_DEBOUNCE_MS = 150

export interface SessionFilter {
  /** Whether the filter field is visible. */
  isOpen: boolean
  /** Raw field value — bind the input to this so typing never lags. */
  query: string
  /** Debounced and trimmed value to match against; empty while closed. */
  activeQuery: string
  /** True when {@link activeQuery} would actually narrow the list. */
  isActive: boolean
  setQuery: (value: string) => void
  toggle: () => void
  /** Hides the field and drops the query. */
  close: () => void
}

/**
 * Open/close plus debounced query state for a sidebar session filter.
 *
 * State is deliberately component-local and never persisted: a filter restored
 * on the next launch would hide sessions and read as data loss.
 */
export function useSessionFilter(): SessionFilter {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, FILTER_DEBOUNCE_MS)

  const close = useCallback(() => {
    setIsOpen(false)
    setQuery('')
  }, [])

  const toggle = useCallback(() => {
    setIsOpen(open => {
      if (open) setQuery('')
      return !open
    })
  }, [])

  // Gate on the debounced value, not on `isOpen`, so opening the field costs
  // nothing until something is actually typed.
  const activeQuery = isOpen ? debouncedQuery.trim() : ''

  return {
    isOpen,
    query,
    activeQuery,
    isActive: activeQuery.length > 0,
    setQuery,
    toggle,
    close,
  }
}
