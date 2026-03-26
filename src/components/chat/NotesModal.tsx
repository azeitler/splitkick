import { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Markdown } from '@/components/ui/markdown'
import { Eye, Pencil } from 'lucide-react'
import { invoke } from '@/lib/transport'
import { useQueryClient } from '@tanstack/react-query'
import { projectsQueryKeys } from '@/services/projects'
import { toast } from 'sonner'

interface NotesModalProps {
  isOpen: boolean
  onClose: () => void
  worktreeId: string
  hasNotes?: boolean
}

export function NotesModal({
  isOpen,
  onClose,
  worktreeId,
  hasNotes,
}: NotesModalProps) {
  const queryClient = useQueryClient()
  const [content, setContent] = useState('')
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [loading, setLoading] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Load notes when modal opens
  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    setDirty(false)
    invoke<string | null>('get_worktree_notes', { worktreeId })
      .then(notes => {
        setContent(notes ?? '')
        setMode(notes ? 'preview' : 'edit')
      })
      .catch(err => toast.error(`Failed to load notes: ${err}`))
      .finally(() => setLoading(false))
  }, [isOpen, worktreeId])

  const handleSave = useCallback(async () => {
    const trimmed = content.trim()
    try {
      await invoke('save_worktree_notes', {
        worktreeId,
        notes: trimmed || null,
      })
      queryClient.invalidateQueries({
        queryKey: [...projectsQueryKeys.all, 'worktree', worktreeId],
      })
      setDirty(false)
      toast.success('Notes saved')
      onClose()
    } catch (err) {
      toast.error(`Failed to save notes: ${err}`)
    }
  }, [content, worktreeId, queryClient, onClose])

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between pr-6">
            <DialogTitle>Notes</DialogTitle>
            <div className="flex items-center gap-1">
              <Button
                variant={mode === 'edit' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2"
                onClick={() => setMode('edit')}
              >
                <Pencil className="h-3 w-3 mr-1" />
                Edit
              </Button>
              <Button
                variant={mode === 'preview' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2"
                onClick={() => setMode('preview')}
                disabled={!content.trim()}
              >
                <Eye className="h-3 w-3 mr-1" />
                Preview
              </Button>
            </div>
          </div>
          <DialogDescription className="sr-only">
            Worktree notes
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto">
          {loading ? (
            <div className="text-muted-foreground text-sm py-8 text-center">
              Loading...
            </div>
          ) : mode === 'edit' ? (
            <Textarea
              value={content}
              onChange={e => {
                setContent(e.target.value)
                setDirty(true)
              }}
              placeholder="Write your notes here... (Markdown supported)"
              className="min-h-[200px] resize-none font-mono text-sm"
              autoFocus
            />
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none rounded-md border p-3 min-h-[200px]">
              <Markdown>{content}</Markdown>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!dirty && !!hasNotes}
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
