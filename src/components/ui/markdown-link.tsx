import { useContext, useState, type MouseEvent, type ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'
import { FileReferencePicker } from '@/components/ui/file-reference-picker'
import { MissingFileReference } from '@/components/ui/missing-file-reference'
import {
  canOpenInEmbeddedBrowser,
  classifyChatLink,
  LocalPathRootContext,
  openChatLink,
  toLocalReferencePath,
} from '@/lib/chat-links'
import { splitFileRefSuffix } from '@/lib/path-utils'
import { useFileReference } from '@/lib/file-reference'

const LINK_CLASS = 'underline underline-offset-2 hover:text-foreground'

/**
 * Markdown link. Web links and local pages open in the embedded browser; the
 * button after the link and Cmd/Ctrl-click open them in the system browser.
 * Other local files open in the file viewer. Links carry `data-chat-link`, so
 * the global external-link interceptor leaves them to this component.
 *
 * A local reference is resolved before it is drawn (`useFileReference`):
 *
 * - One file → a link that opens exactly that file, wherever it turned out
 *   to be, rather than whatever the worktree root plus the reference spells.
 * - Several → a link that asks which one.
 * - None → no link, but still marked as a file, with a question-mark icon
 *   and a tooltip that says why. A link that can only open an error is worse
 *   than no link, because it looks the same as one that works.
 */
export function MarkdownLink({
  href,
  children,
}: {
  href?: string
  children: ReactNode
}) {
  const rootPath = useContext(LocalPathRootContext)
  const kind = classifyChatLink(href)
  const [pickerOpen, setPickerOpen] = useState(false)
  const reference = useFileReference(href, {
    enabled: kind === 'page' || kind === 'file',
  })

  if (!kind) {
    return (
      <a
        href={href}
        className={LINK_CLASS}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    )
  }

  const open = (system: boolean, path?: string | null) =>
    openChatLink(href, {
      system,
      rootPath,
      resolvedPath: path ?? reference.path,
    })

  if (reference.status === 'missing') {
    return (
      <MissingFileReference
        reference={
          toLocalReferencePath(splitFileRefSuffix(href ?? '')[0]) ?? href ?? ''
        }
      >
        {children}
      </MissingFileReference>
    )
  }

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const system = event.metaKey || event.ctrlKey
    if (reference.status === 'ambiguous' && !system) {
      event.preventDefault()
      setPickerOpen(true)
      return
    }
    // A local href (`docs/a.md`, `~/a.md`) means nothing to the web view, so
    // it must never navigate by itself — not even in the moment before a
    // `~/…` reference, which has no fallback path, has resolved.
    if (open(system) || kind !== 'web') event.preventDefault()
  }

  const link = (
    <a
      href={href}
      data-chat-link=""
      data-file-reference={
        reference.status === 'disabled' ? undefined : reference.status
      }
      onClick={handleClick}
      className={LINK_CLASS}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  )

  return (
    <>
      {reference.status === 'ambiguous' ? (
        <FileReferencePicker
          candidates={reference.candidates}
          rootPath={reference.root ?? rootPath}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onSelect={path => open(false, path)}
        >
          {link}
        </FileReferencePicker>
      ) : (
        link
      )}
      {canOpenInEmbeddedBrowser(kind) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => open(true)}
              aria-label="Open in system browser"
              className="ml-0.5 inline-flex cursor-pointer rounded-sm p-0.5 align-middle text-muted-foreground opacity-60 transition-opacity hover:bg-muted hover:text-foreground hover:opacity-100"
            >
              <ExternalLink className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Open in system browser</TooltipContent>
        </Tooltip>
      )}
    </>
  )
}
