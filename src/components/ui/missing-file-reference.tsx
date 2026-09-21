import type { ReactNode } from 'react'
import { FileQuestionMark } from 'lucide-react'
import { isHomeRelativePath } from '@/lib/path-utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

/**
 * Why a file reference in chat is not a link.
 *
 * Shared by the inline marker and the `@`-mention badge, so both say the
 * same thing. It names what was checked: without that, "not found" reads like
 * Jean did not try.
 */
export function MissingFileReferenceExplanation({
  reference,
}: {
  reference: string
}) {
  return (
    <div className="flex max-w-72 flex-col gap-1">
      <span className="font-medium">No file at {reference}</span>
      <span className="text-xs opacity-80">
        {isHomeRelativePath(reference)
          ? 'Jean looked for it in the home folder, so this is not a link.'
          : 'Jean checked the files this session touched and searched the worktree, so this is not a link.'}{' '}
        It becomes one if a later turn creates the file.
      </span>
    </div>
  )
}

/**
 * A file reference in a chat answer that resolved to nothing.
 *
 * Still marked as a file — dotted underline and a question-mark icon — so the
 * reader sees that the answer named a file and that something is off with it.
 * Plain text would hide that; a link would only open an error.
 */
export function MissingFileReference({
  reference,
  children,
}: {
  reference: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Focusable, so the explanation is reachable without a mouse. It
            takes the tab stop the link would have had. */}
        <span
          tabIndex={0}
          data-file-reference="missing"
          className="inline-flex items-baseline gap-0.5 rounded-sm text-muted-foreground underline decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {children}
          <FileQuestionMark
            aria-label="File not found"
            className="size-3 shrink-0 self-center no-underline"
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <MissingFileReferenceExplanation reference={reference} />
      </TooltipContent>
    </Tooltip>
  )
}
