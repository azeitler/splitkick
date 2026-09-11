import { useContext, type MouseEvent, type ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'
import {
  canOpenInEmbeddedBrowser,
  classifyChatLink,
  LocalPathRootContext,
  openChatLink,
} from '@/lib/chat-links'

const LINK_CLASS = 'underline underline-offset-2 hover:text-foreground'

/**
 * Markdown link. Web links and local HTML pages open in the embedded
 * browser; the button after the link and Cmd/Ctrl-click open them in the
 * system browser. Other local files open in the file viewer. Links carry
 * `data-chat-link`, so the global external-link interceptor leaves them to
 * this component.
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

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      openChatLink(href, { system: event.metaKey || event.ctrlKey, rootPath })
    ) {
      event.preventDefault()
    }
  }

  return (
    <>
      <a
        href={href}
        data-chat-link=""
        onClick={handleClick}
        className={LINK_CLASS}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
      {canOpenInEmbeddedBrowser(kind) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => openChatLink(href, { system: true, rootPath })}
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
