import { useState, useCallback, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tag } from 'lucide-react'
import { useChatStore } from '@/store/chat-store'
import { toast } from 'sonner'

const PRESET_LABELS = ['Needs testing']

interface LabelModalProps {
  isOpen: boolean
  onClose: () => void
  sessionId: string | null
  currentLabel: string | null
}

export function LabelModal({
  isOpen,
  onClose,
  sessionId,
  currentLabel,
}: LabelModalProps) {
  const [inputValue, setInputValue] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(0)

  const sessionLabels = useChatStore(state => state.sessionLabels)
  const customLabels = useMemo(() => {
    const presetSet = new Set(PRESET_LABELS)
    const unique = new Set<string>()
    for (const label of Object.values(sessionLabels)) {
      if (!presetSet.has(label)) unique.add(label)
    }
    return [...unique].sort()
  }, [sessionLabels])

  const allLabels = useMemo(
    () => [...PRESET_LABELS, ...customLabels],
    [customLabels]
  )

  const applyLabel = useCallback(
    (label: string | null) => {
      if (!sessionId) return
      useChatStore.getState().setSessionLabel(sessionId, label)
      toast.success(label ? `Labeled: ${label}` : 'Label removed')
      onClose()
    },
    [sessionId, onClose]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex(i => (i + 1) % allLabels.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex(i => (i - 1 + allLabels.length) % allLabels.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const label = allLabels[focusedIndex]
        if (label) applyLabel(label)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        applyLabel(null)
      }
    },
    [focusedIndex, applyLabel, allLabels]
  )

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-[320px]" onKeyDown={e => { e.stopPropagation(); handleKeyDown(e) }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4" />
            Session Label
          </DialogTitle>
          <DialogDescription>
            Pick a label or type a custom one.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-0.5">
          {allLabels.map((label, i) => (
            <button
              key={label}
              className={`flex items-center h-8 px-3 text-sm rounded-md text-left transition-colors ${
                focusedIndex === i
                  ? 'bg-accent text-accent-foreground'
                  : currentLabel === label
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-accent/50'
              }`}
              onClick={() => applyLabel(label)}
              onMouseEnter={() => setFocusedIndex(i)}
              tabIndex={-1}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="border-t pt-2">
          <Input
            placeholder="Custom label..."
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
                const trimmed = inputValue.trim()
                applyLabel(trimmed || null)
              }
            }}
            tabIndex={-1}
          />
        </div>

        <div className="flex gap-3 text-[10px] text-muted-foreground px-1">
          <span><kbd className="px-1 rounded border bg-muted">↵</kbd>{' '}apply</span>
          <span><kbd className="px-1 rounded border bg-muted">⌫</kbd>{' '}remove</span>
          <span><kbd className="px-1 rounded border bg-muted">↑↓</kbd>{' '}navigate</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
