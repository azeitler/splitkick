import { useUIStore } from '@/store/ui-store'
import type { Session } from '@/types/chat'

/** Open the "Link to Graph…" dialog (#88) for a session. */
export function openLinkToGraph(
  session: Pick<Session, 'id' | 'name' | 'serves'>
): void {
  useUIStore.getState().setLinkToGraphTarget({
    sessionId: session.id,
    sessionName: session.name,
    serves: session.serves ?? [],
  })
}
