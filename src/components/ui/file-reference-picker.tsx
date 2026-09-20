import type { ReactNode } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { getFilename, normalizePath } from '@/lib/path-utils'

interface FileReferencePickerProps {
  /** Every path that exists for this reference, best first. */
  candidates: string[]
  /** Trimmed off the front of each path in the list, when it matches. */
  rootPath?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (path: string) => void
  /** The link or badge the list is anchored to. */
  children: ReactNode
}

/** Shorten a path for the list: drop a shared root, keep the rest. */
function displayPath(path: string, rootPath?: string | null): string {
  if (!rootPath) return path
  const root = normalizePath(rootPath).replace(/\/+$/, '')
  const normalized = normalizePath(path)
  return normalized.startsWith(`${root}/`)
    ? normalized.slice(root.length + 1)
    : normalized
}

/**
 * Ask which file a reference meant.
 *
 * Twelve packages can each hold a `README.md`. Picking the first one silently
 * is how a link opens the wrong file and the user never learns why, so when
 * more than one candidate exists the click shows them all instead.
 */
export function FileReferencePicker({
  candidates,
  rootPath,
  open,
  onOpenChange,
  onSelect,
  children,
}: FileReferencePickerProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent align="start" className="w-80 p-1.5">
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          {candidates.length} files match — which one?
        </div>
        <ul className="max-h-64 overflow-auto">
          {candidates.map(candidate => (
            <li key={candidate}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                onClick={() => {
                  onOpenChange(false)
                  onSelect(candidate)
                }}
              >
                <span className="text-xs font-medium">
                  {getFilename(candidate)}
                </span>
                <span className="w-full truncate text-[11px] text-muted-foreground">
                  {displayPath(candidate, rootPath)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
