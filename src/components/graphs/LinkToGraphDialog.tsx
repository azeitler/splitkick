import { useState } from 'react'
import { Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useGraphs } from '@/services/graphs'
import { useUIStore, type LinkToGraphTarget } from '@/store/ui-store'
import { ServesEditor } from './ServesEditor'

function LinkToGraphBody({ target }: { target: LinkToGraphTarget }) {
  // The refs when the dialog opened, then each saved result.
  const [serves, setServes] = useState(target.serves)
  const { data: graphs, isLoading } = useGraphs()

  if (!isLoading && (graphs ?? []).length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
        <p>There is no graph yet. Create one, then link the session to it.</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            const ui = useUIStore.getState()
            ui.setLinkToGraphTarget(null)
            ui.setNewGraphDialogOpen(true)
          }}
        >
          New Graph…
        </Button>
      </div>
    )
  }
  return (
    <ServesEditor
      sessionId={target.sessionId}
      serves={serves}
      onChange={setServes}
    />
  )
}

/**
 * Link a session to graph nodes or whole graphs (#88). Opens from the
 * session context menu and ⌘K, for every session, also in Web Access.
 */
export function LinkToGraphDialog() {
  const target = useUIStore(state => state.linkToGraphTarget)
  const close = () => useUIStore.getState().setLinkToGraphTarget(null)

  return (
    <Dialog open={!!target} onOpenChange={next => !next && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Workflow className="h-4 w-4" />
            Link to Graph
          </DialogTitle>
          <DialogDescription>
            {target
              ? `Pick a graph, then a node or the whole graph. "${target.sessionName}" serves what it is linked to and gets the graph panel.`
              : null}
          </DialogDescription>
        </DialogHeader>
        {target && <LinkToGraphBody key={target.sessionId} target={target} />}
        <DialogFooter>
          <Button type="button" onClick={close}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
