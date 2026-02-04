import { Sparkles } from 'lucide-react'
import type { SessionDigest } from '@/types/chat'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface RecapDialogProps {
  digest: SessionDigest | null
  isOpen: boolean
  onClose: () => void
}

export function RecapDialog({ digest, isOpen, onClose }: RecapDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span>Session Recap</span>
          </DialogTitle>
        </DialogHeader>
        {digest ? (
          <div className="space-y-4 pt-2">
            <div>
              <p className="text-sm text-foreground">{digest.chat_summary}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  Last action:
                </span>{' '}
                {digest.last_action}
              </p>
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            No recap available
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
