import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { readPlanFile } from '@/services/chat'
import { Markdown } from '@/components/ui/markdown'
import { getFilename } from '@/lib/path-utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'

interface PlanDialogBaseProps {
  isOpen: boolean
  onClose: () => void
}

interface PlanDialogFileProps extends PlanDialogBaseProps {
  filePath: string
  content?: never
}

interface PlanDialogContentProps extends PlanDialogBaseProps {
  content: string
  filePath?: never
}

type PlanDialogProps = PlanDialogFileProps | PlanDialogContentProps

export function PlanDialog({ filePath, content: inlineContent, isOpen, onClose }: PlanDialogProps) {
  const filename = filePath ? getFilename(filePath) : null

  const { data: fetchedContent, isLoading } = useQuery({
    queryKey: ['planFile', filePath],
    queryFn: () => readPlanFile(filePath!),
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 1,
    enabled: isOpen && !!filePath && !inlineContent,
  })

  const content = inlineContent ?? fetchedContent

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-7xl h-[80vh] min-w-[90vw] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            <span>Plan</span>
            {filename && (
              <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                {filename}
              </code>
            )}
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 min-h-0 -mx-6 px-6">
          {!inlineContent && isLoading ? (
            <div className="text-sm text-muted-foreground">Loading plan...</div>
          ) : content ? (
            <Markdown className="text-sm">{content}</Markdown>
          ) : (
            <div className="text-sm text-destructive">
              Failed to load plan file
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
