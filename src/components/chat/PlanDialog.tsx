import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, RotateCcw } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { readPlanFile } from '@/services/chat'
import { getFilename } from '@/lib/path-utils'
import { useUIStore } from '@/store/ui-store'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Markdown } from '@/components/ui/markdown'

export interface ApprovalContext {
  worktreeId: string
  worktreePath: string
  sessionId: string
  pendingPlanMessageId: string | null
}

interface PlanDialogBaseProps {
  isOpen: boolean
  onClose: () => void
  editable?: boolean
  approvalContext?: ApprovalContext
  onApprove?: (updatedPlan: string) => void
  onApproveYolo?: (updatedPlan: string) => void
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

export function PlanDialog({
  filePath,
  content: inlineContent,
  isOpen,
  onClose,
  editable = false,
  approvalContext: _approvalContext,
  onApprove,
  onApproveYolo,
}: PlanDialogProps) {
  const filename = filePath ? getFilename(filePath) : null
  const queryClient = useQueryClient()

  const { data: fetchedContent, isLoading } = useQuery({
    queryKey: ['planFile', filePath],
    queryFn: () => readPlanFile(filePath!),
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 1,
    enabled: isOpen && !!filePath && !inlineContent,
  })

  const originalContent = inlineContent ?? fetchedContent ?? ''
  const [editedContent, setEditedContent] = useState('')

  // Sync edited content when original changes or dialog opens
  useEffect(() => {
    if (isOpen && originalContent) {
      setEditedContent(originalContent)
    }
  }, [isOpen, originalContent])

  // Track dialog open state in UIStore to block canvas keybindings
  useEffect(() => {
    useUIStore.getState().setPlanDialogOpen(isOpen)
    return () => useUIStore.getState().setPlanDialogOpen(false)
  }, [isOpen])

  const hasChanges = editedContent !== originalContent
  // Enable approve buttons when callbacks are provided (caller decides when approval is valid)
  const canApprove = !!onApprove && !!onApproveYolo

  // Auto-save plan file with debounce when content changes
  useEffect(() => {
    if (!filePath || !hasChanges || !isOpen || !editable) return

    const timer = setTimeout(async () => {
      try {
        await invoke('write_file_content', {
          path: filePath,
          content: editedContent,
        })
        queryClient.invalidateQueries({ queryKey: ['planFile', filePath] })
      } catch (err) {
        console.error('[PlanDialog] Auto-save failed:', err)
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [filePath, editedContent, hasChanges, isOpen, editable, queryClient])

  // Debug logging
  console.log(
    '[PlanDialog] render - canApprove:',
    canApprove,
    'onApprove:',
    !!onApprove,
    'onApproveYolo:',
    !!onApproveYolo,
    'editable:',
    editable
  )

  const handleReset = useCallback(() => {
    setEditedContent(originalContent)
  }, [originalContent])

  const handleApprove = useCallback(() => {
    // File is auto-saved, just call the approve callback
    onApprove?.(editedContent)
    onClose()
  }, [editedContent, onApprove, onClose])

  const handleApproveYolo = useCallback(() => {
    // File is auto-saved, just call the approve callback
    onApproveYolo?.(editedContent)
    onClose()
  }, [editedContent, onApproveYolo, onClose])

  // Keyboard shortcuts for approve actions
  useEffect(() => {
    if (!isOpen || !editable) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey

      // Mod+Enter = Approve
      if (isMod && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (canApprove) {
          handleApprove()
        }
      }

      // Mod+Y = Approve Yolo
      if (isMod && e.key === 'y') {
        e.preventDefault()
        if (canApprove) {
          handleApproveYolo()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, editable, canApprove, handleApprove, handleApproveYolo])

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

        {editable ? (
          // Editable mode: textarea
          <Textarea
            value={editedContent}
            onChange={e => setEditedContent(e.target.value)}
            className="flex-1 min-h-0 resize-none font-mono text-sm"
            placeholder="Loading plan..."
          />
        ) : (
          // Read-only mode: markdown
          <ScrollArea className="flex-1 min-h-0 -mx-6 px-6">
            {!inlineContent && isLoading ? (
              <div className="text-sm text-muted-foreground">
                Loading plan...
              </div>
            ) : originalContent ? (
              <Markdown className="text-sm">{originalContent}</Markdown>
            ) : (
              <div className="text-sm text-destructive">
                Failed to load plan file
              </div>
            )}
          </ScrollArea>
        )}

        {editable && (
          <DialogFooter className="shrink-0 border-t pt-4 -mx-6 px-6 mt-4 sm:justify-between">
            {/* Left side: Reset button */}
            <Button
              variant="ghost"
              onClick={handleReset}
              disabled={!hasChanges}
              className="sm:mr-auto"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset
            </Button>

            {/* Right side: Approve buttons */}
            <div className="flex gap-2">
              <Button onClick={handleApprove} disabled={!canApprove}>
                Approve
              </Button>
              <Button
                variant="destructive"
                onClick={handleApproveYolo}
                disabled={!canApprove}
              >
                Approve (yolo)
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
