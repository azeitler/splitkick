import { AlertCircle, CheckCircle2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useUIStore } from '@/store/ui-store'

function close() {
  useUIStore.getState().setUpdateCheckResult(null)
}

/** The answer of a manual "Check for Updates": up to date, busy, or an error. */
export function UpdateCheckResultDialog() {
  const result = useUIStore(state => state.updateCheckResult)
  const isError = result?.kind === 'error'
  const Icon = isError ? AlertCircle : CheckCircle2

  return (
    <Dialog
      open={result !== null}
      onOpenChange={open => {
        if (!open) close()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon
              className={
                isError ? 'size-5 text-destructive' : 'size-5 text-primary'
              }
            />
            Check for Updates
          </DialogTitle>
          <DialogDescription className="break-words">
            {result?.text}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end pt-2">
          <Button onClick={close} autoFocus>
            OK
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
