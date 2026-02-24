import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'

export interface TeardownOutputDetail {
  output: string
  success: boolean
}

/**
 * Dialog that displays teardown script output.
 *
 * Opened via the 'show-teardown-output' custom DOM event, dispatched
 * from toast action buttons in projects.ts event listeners.
 */
export function TeardownOutputDialog() {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<TeardownOutputDetail | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent<TeardownOutputDetail>).detail
      setDetail(data)
      setOpen(true)
    }

    window.addEventListener('show-teardown-output', handler)
    return () => window.removeEventListener('show-teardown-output', handler)
  }, [])

  const success = detail?.success ?? true
  const Icon = success ? CheckCircle2 : XCircle

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon
              className={`size-4 ${success ? 'text-green-500' : 'text-destructive'}`}
            />
            {success ? 'Teardown Completed' : 'Teardown Failed'}
          </DialogTitle>
          <DialogDescription>
            {success
              ? 'The teardown script ran successfully before deletion.'
              : 'The teardown script failed. The worktree was not deleted.'}
          </DialogDescription>
        </DialogHeader>
        {detail?.output && (
          <ScrollArea className="max-h-[50vh]">
            <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              {detail.output}
            </pre>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}
