import { useSessionLink } from '@/services/chat'
import { SessionLinkRow } from './SessionLinkInsert'

/** Top-of-chat row naming the session that started (or was forked into) this one (#62). */
export function SessionOriginBanner({
  startedBySessionId,
  forkedFromSessionId,
}: {
  startedBySessionId?: string | null
  forkedFromSessionId?: string | null
}) {
  const originId = startedBySessionId || forkedFromSessionId || null
  const { data: link, isSuccess } = useSessionLink(originId)
  if (!originId || !isSuccess) return null
  const prefix = startedBySessionId ? 'Started by' : 'Forked from'
  return (
    <SessionLinkRow
      prefix={prefix}
      link={link}
      goneText={`${prefix} a session that is no longer available`}
      className="mb-2"
    />
  )
}
