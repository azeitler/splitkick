import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  memo,
  useTransition,
} from 'react'
import {
  FileText,
  Loader2,
  AlertCircle,
  RefreshCw,
  Columns2,
  Rows3,
  MessageSquarePlus,
  Play,
  Pencil,
  X,
} from 'lucide-react'
import { FileDiff } from '@pierre/diffs/react'
import {
  parsePatchFiles,
  type SelectedLineRange,
  type DiffLineAnnotation,
  type FileDiffMetadata,
} from '@pierre/diffs'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { generateId } from '@/lib/uuid'
import { getFilename } from '@/lib/path-utils'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'
import { getGitDiff } from '@/services/git-status'
import { useTheme } from '@/hooks/use-theme'
import { usePreferences } from '@/services/preferences'
import type { GitDiff, DiffRequest } from '@/types/git-diff'
import type { SyntaxTheme } from '@/types/preferences'

// PERFORMANCE: Stable empty array reference for files without comments
// This prevents unnecessary re-renders since the reference never changes
const EMPTY_ANNOTATIONS: DiffLineAnnotation<DiffComment>[] = []

/** A comment attached to a line range in a diff */
export interface DiffComment {
  id: string
  fileName: string
  side: 'deletions' | 'additions'
  startLine: number
  endLine: number
  comment: string
}

/** Props for the memoized FileDiff wrapper */
export interface MemoizedFileDiffProps {
  fileDiff: FileDiffMetadata
  fileName: string
  annotations: DiffLineAnnotation<DiffComment>[]
  selectedLines: SelectedLineRange | null
  themeType: 'dark' | 'light'
  syntaxThemeDark: SyntaxTheme
  syntaxThemeLight: SyntaxTheme
  diffStyle: 'split' | 'unified'
  onLineSelected: (range: SelectedLineRange | null) => void
  onRemoveComment: (id: string) => void
}

/** Get file status badge color */
function getStatusColor(type: string) {
  switch (type) {
    case 'new':
      return 'text-green-500'
    case 'deleted':
      return 'text-red-500'
    case 'rename-pure':
    case 'rename-changed':
      return 'text-yellow-500'
    default:
      return 'text-blue-500'
  }
}

/** Memoized FileDiff wrapper to prevent unnecessary re-renders */
export const MemoizedFileDiff = memo(
  function MemoizedFileDiff({
    fileDiff,
    fileName,
    annotations,
    selectedLines,
    themeType,
    syntaxThemeDark,
    syntaxThemeLight,
    diffStyle,
    onLineSelected,
    onRemoveComment,
  }: MemoizedFileDiffProps) {
    const [forceShow, setForceShow] = useState(false)
    const [isLoadingDiff, startLoadingDiff] = useTransition()

    // Memoize options to keep reference stable
    const options = useMemo(
      () => ({
        theme: {
          dark: syntaxThemeDark,
          light: syntaxThemeLight,
        },
        themeType,
        diffStyle,
        overflow: 'wrap' as const,
        enableLineSelection: true,
        onLineSelected,
        disableFileHeader: true, // We render file info in sidebar
        unsafeCSS: `
      pre { font-family: var(--font-family-mono) !important; font-size: calc(var(--ui-font-size) * 0.85) !important; line-height: var(--ui-line-height) !important; }
    `,
      }),
      [themeType, syntaxThemeDark, syntaxThemeLight, diffStyle, onLineSelected]
    )

    const renderAnnotation = useCallback(
      (annotation: DiffLineAnnotation<DiffComment>) => (
        <div className="flex items-center gap-2 px-2 py-1 bg-primary/10 border-l-2 border-primary text-xs">
          <MessageSquarePlus className="h-3 w-3 text-primary shrink-0" />
          <span className="text-foreground">
            {annotation.metadata?.comment}
          </span>
          <button
            type="button"
            onClick={() =>
              annotation.metadata && onRemoveComment(annotation.metadata.id)
            }
            className="ml-auto p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ),
      [onRemoveComment]
    )

    // Calculate stats from hunks for the header
    const stats = useMemo(() => {
      let additions = 0
      let deletions = 0
      for (const hunk of fileDiff.hunks) {
        additions += hunk.additionCount
        deletions += hunk.deletionCount
      }
      return { additions, deletions }
    }, [fileDiff.hunks])

    return (
      <div className="border border-border">
        {/* File header - shows full path and rename info */}
        <div className="flex items-center gap-2 px-3 py-2 bg-muted border-b border-border sticky top-0 z-10">
          <FileText
            className={cn(
              'h-[1em] w-[1em] shrink-0',
              getStatusColor(fileDiff.type)
            )}
          />
          <span className="truncate">{fileName}</span>
          {fileDiff.prevName && fileDiff.prevName !== fileName && (
            <span className="text-muted-foreground truncate">
              ← {fileDiff.prevName}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {stats.additions > 0 && (
              <span className="text-green-500">+{stats.additions}</span>
            )}
            {stats.deletions > 0 && (
              <span className="text-red-500">-{stats.deletions}</span>
            )}
          </div>
        </div>
        {/* Diff content */}
        {fileDiff.hunks.length === 0 ||
        fileDiff.hunks.every(h => h.hunkContent.length === 0) ? (
          <div className="px-4 py-8 text-center text-muted-foreground text-sm">
            {fileDiff.type === 'deleted'
              ? 'This file was deleted'
              : fileDiff.type === 'new'
                ? 'Empty file added'
                : 'Empty file'}
          </div>
        ) : stats.additions + stats.deletions > 1500 && !forceShow ? (
          <div className="px-4 py-8 flex flex-col items-center gap-3 text-muted-foreground text-sm">
            {isLoadingDiff ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Rendering diff...</span>
              </>
            ) : (
              <>
                <span>
                  Large diff — {(stats.additions + stats.deletions).toLocaleString()} lines changed
                </span>
                <button
                  type="button"
                  onClick={() => startLoadingDiff(() => setForceShow(true))}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-muted hover:bg-accent transition-colors"
                >
                  Show diff
                </button>
              </>
            )}
          </div>
        ) : (
          <FileDiff
            fileDiff={fileDiff}
            lineAnnotations={annotations}
            selectedLines={selectedLines}
            options={options}
            renderAnnotation={renderAnnotation}
          />
        )}
      </div>
    )
  },
  (prevProps, nextProps) => {
    // Custom comparison to prevent unnecessary re-renders
    if (prevProps.selectedLines !== nextProps.selectedLines) {
      // If both are null, treat as equal (don't trigger re-render)
      if (
        prevProps.selectedLines === null &&
        nextProps.selectedLines === null
      ) {
        // Same - don't trigger re-render based on this
      } else {
        return false // Props changed, re-render
      }
    }

    // For other props, use strict equality
    return (
      prevProps.fileDiff === nextProps.fileDiff &&
      prevProps.fileName === nextProps.fileName &&
      prevProps.annotations === nextProps.annotations &&
      prevProps.themeType === nextProps.themeType &&
      prevProps.syntaxThemeDark === nextProps.syntaxThemeDark &&
      prevProps.syntaxThemeLight === nextProps.syntaxThemeLight &&
      prevProps.diffStyle === nextProps.diffStyle &&
      prevProps.onLineSelected === nextProps.onLineSelected &&
      prevProps.onRemoveComment === nextProps.onRemoveComment
    )
  }
)

/** Props for the isolated comment input bar */
interface CommentInputBarProps {
  activeFileName: string | null
  selectedRange: SelectedLineRange | null
  onAddComment: (comment: string) => void
  onCancel: () => void
}

/**
 * Isolated comment input component to prevent re-renders of the entire modal
 * when the user types in the input field
 */
const CommentInputBar = memo(function CommentInputBar({
  activeFileName,
  selectedRange,
  onAddComment,
  onCancel,
}: CommentInputBarProps) {
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input when mounted
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  const handleSubmit = useCallback(() => {
    if (inputValue.trim()) {
      onAddComment(inputValue.trim())
      setInputValue('')
    }
  }, [inputValue, onAddComment])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && inputValue.trim()) {
        handleSubmit()
      } else if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    },
    [inputValue, handleSubmit, onCancel]
  )

  if (!selectedRange) return null

  return (
    <div className="flex items-center gap-2 px-3 h-10 bg-muted rounded-md border border-border">
      <MessageSquarePlus className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="text-xs text-muted-foreground shrink-0">
        {activeFileName ? getFilename(activeFileName) : ''}:
        {selectedRange.start}
        {selectedRange.end !== selectedRange.start && `-${selectedRange.end}`}
      </span>
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={e => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="What should I do with this code?"
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!inputValue.trim()}
        className="px-2 py-1 bg-black text-white dark:bg-yellow-500 dark:text-black hover:bg-black/80 dark:hover:bg-yellow-400 rounded text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Add
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="p-1 text-muted-foreground hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
})

interface GitDiffModalProps {
  /** Diff request parameters, or null to close the modal */
  diffRequest: DiffRequest | null
  /** Callback when modal is closed */
  onClose: () => void
  /** Callback when user wants to add comments to input for editing */
  onAddToPrompt?: (reference: string) => void
  /** Callback when user wants to execute comments immediately */
  onExecutePrompt?: (reference: string) => void
}

type DiffStyle = 'split' | 'unified'

/**
 * Modal dialog for viewing GitHub-style git diffs using @pierre/diffs
 */
export function GitDiffModal({
  diffRequest,
  onClose,
  onAddToPrompt,
  onExecutePrompt,
}: GitDiffModalProps) {
  const [diff, setDiff] = useState<GitDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('split')
  const dialogContentRef = useRef<HTMLDivElement>(null)
  const { theme } = useTheme()
  const { data: preferences } = usePreferences()

  // Comment/selection state
  const [comments, setComments] = useState<DiffComment[]>([])
  const [selectedRange, setSelectedRange] = useState<SelectedLineRange | null>(
    null
  )
  const [activeFileName, setActiveFileName] = useState<string | null>(null)
  const [showCommentInput, setShowCommentInput] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Sidebar file selection state
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0)
  const fileListRef = useRef<HTMLDivElement>(null)

  // Use transition for file switching to keep UI responsive during heavy diff rendering
  const [, startTransition] = useTransition()

  // Manual switching state for consistent visual feedback
  // (useTransition's isPending is too fast for small diffs)
  const [isSwitching, setIsSwitching] = useState(false)
  const switchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Resolve theme to actual dark/light value
  const resolvedThemeType = useMemo((): 'dark' | 'light' => {
    if (theme === 'system') {
      // Check system preference
      return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
    }
    return theme
  }, [theme])

  const loadDiff = useCallback(
    async (request: DiffRequest, isRefresh = false) => {
      setIsLoading(true)
      setError(null)
      // Only clear diff on initial load, not on refresh
      if (!isRefresh) {
        setDiff(null)
      }

      try {
        const result = await getGitDiff(
          request.worktreePath,
          request.type,
          request.baseBranch
        )
        setDiff(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setIsLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    if (diffRequest) {
      loadDiff(diffRequest)
      // Reset to first file when opening/reloading
      setSelectedFileIndex(0)
    } else {
      // Reset state when modal closes
      setDiff(null)
      setError(null)
      setIsLoading(false)
      // Also reset comment state
      setComments([])
      setSelectedRange(null)
      setActiveFileName(null)
      setShowCommentInput(false)
      setSelectedFileIndex(0)
      setIsSwitching(false)
      if (switchTimeoutRef.current) {
        clearTimeout(switchTimeoutRef.current)
      }
    }
  }, [diffRequest, loadDiff])

  // Store line selection callbacks per file to maintain stable references
  const lineSelectedCallbacksRef = useRef<
    Map<string, (range: SelectedLineRange | null) => void>
  >(new Map())

  // Get or create a stable callback for a specific file
  const getLineSelectedCallback = useCallback((fileName: string) => {
    let callback = lineSelectedCallbacksRef.current.get(fileName)
    if (!callback) {
      callback = (range: SelectedLineRange | null) => {
        setSelectedRange(range)
        setActiveFileName(range ? fileName : null)
        if (range) {
          setShowCommentInput(true)
        }
      }
      lineSelectedCallbacksRef.current.set(fileName, callback)
    }
    return callback
  }, [])

  // Add a comment for the current selection (receives comment text from isolated input)
  const handleAddComment = useCallback(
    (commentText: string) => {
      if (!selectedRange || !activeFileName || !commentText) return

      const newComment: DiffComment = {
        id: generateId(),
        fileName: activeFileName,
        side: selectedRange.side ?? 'additions',
        startLine: Math.min(selectedRange.start, selectedRange.end),
        endLine: Math.max(selectedRange.start, selectedRange.end),
        comment: commentText,
      }

      setComments(prev => [...prev, newComment])
      setSelectedRange(null)
      setShowCommentInput(false)
    },
    [selectedRange, activeFileName]
  )

  // Remove a comment
  const handleRemoveComment = useCallback((commentId: string) => {
    setComments(prev => prev.filter(c => c.id !== commentId))
  }, [])

  // Cancel comment input
  const handleCancelComment = useCallback(() => {
    setShowCommentInput(false)
    setSelectedRange(null)
  }, [])

  // Format comments for sending
  const formatComments = useCallback(() => {
    return comments
      .map(c => {
        const lineRange =
          c.startLine === c.endLine
            ? `line ${c.startLine}`
            : `lines ${c.startLine}-${c.endLine}`
        return `In ${c.fileName} (${lineRange}, ${c.side === 'deletions' ? 'old code' : 'new code'}): "${c.comment}"`
      })
      .join('\n\n')
  }, [comments])

  // Add comments to input for editing
  const handleAddToPrompt = useCallback(() => {
    if (comments.length === 0 || !onAddToPrompt) return
    onAddToPrompt(formatComments())
    setComments([])
    onClose()
  }, [comments, onAddToPrompt, formatComments, onClose])

  // Execute comments immediately
  const handleExecutePrompt = useCallback(() => {
    if (comments.length === 0 || !onExecutePrompt) return
    onExecutePrompt(formatComments())
    setComments([])
    onClose()
  }, [comments, onExecutePrompt, formatComments, onClose])

  // PERFORMANCE: Pre-compute annotations map for stable references
  // This ensures that files without comment changes don't re-render
  const annotationsByFile = useMemo(() => {
    const map = new Map<string, DiffLineAnnotation<DiffComment>[]>()

    for (const comment of comments) {
      const existing = map.get(comment.fileName) ?? []
      const newAnnotations = Array.from(
        { length: comment.endLine - comment.startLine + 1 },
        (_, i) => ({
          side: comment.side,
          lineNumber: comment.startLine + i,
          metadata: comment,
        })
      )
      map.set(comment.fileName, [...existing, ...newAnnotations])
    }

    return map
  }, [comments])

  // Getter returns stable references from the map
  const getAnnotationsForFile = useCallback(
    (fileName: string): DiffLineAnnotation<DiffComment>[] =>
      annotationsByFile.get(fileName) ?? EMPTY_ANNOTATIONS,
    [annotationsByFile]
  )

  // Parse the raw patch into individual file diffs
  const parsedFiles = useMemo(() => {
    if (!diff?.raw_patch) return []
    try {
      return parsePatchFiles(diff.raw_patch)
    } catch (e) {
      console.error('Failed to parse patch:', e)
      return []
    }
  }, [diff?.raw_patch])

  // Flatten files into stable array for sidebar and selection
  // Pre-compute stats to avoid calculation during render
  // Also merge any files from the backend that the patch parser missed (e.g., deleted/binary files)
  const flattenedFiles = useMemo(() => {
    const fromPatch = parsedFiles.flatMap((patch, patchIndex) =>
      patch.files.map((fileDiff, fileIndex) => {
        // Pre-compute stats from hunks
        let additions = 0
        let deletions = 0
        for (const hunk of fileDiff.hunks) {
          additions += hunk.additionCount
          deletions += hunk.deletionCount
        }
        return {
          fileDiff,
          fileName: fileDiff.name || fileDiff.prevName || 'unknown',
          key: `${patchIndex}-${fileIndex}`,
          additions,
          deletions,
        }
      })
    )

    // Add files from backend that the patch parser missed (deleted, binary, etc.)
    if (diff?.files) {
      const parsedPaths = new Set(fromPatch.map(f => f.fileName))
      const statusToType: Record<string, string> = {
        deleted: 'deleted',
        added: 'new',
        renamed: 'rename-changed',
        modified: 'change',
      }
      for (const backendFile of diff.files) {
        if (!parsedPaths.has(backendFile.path)) {
          fromPatch.push({
            fileDiff: {
              name: backendFile.path,
              prevName: backendFile.old_path ?? undefined,
              type: (statusToType[backendFile.status] ?? 'change') as FileDiffMetadata['type'],
              hunks: [],
              splitLineCount: 0,
              unifiedLineCount: 0,
            } as FileDiffMetadata,
            fileName: backendFile.path,
            key: `backend-${backendFile.path}`,
            additions: backendFile.additions,
            deletions: backendFile.deletions,
          })
        }
      }
    }

    return fromPatch
  }, [parsedFiles, diff?.files])

  // Get currently selected file
  const selectedFile =
    flattenedFiles.length > 0 && selectedFileIndex < flattenedFiles.length
      ? flattenedFiles[selectedFileIndex]
      : null

  // Check if there are any files to display
  const hasFiles = flattenedFiles.length > 0

  // Handle file selection from sidebar
  // Use transition to keep sidebar responsive while diff renders
  const handleSelectFile = useCallback((index: number) => {
    // Clear any pending timeout
    if (switchTimeoutRef.current) {
      clearTimeout(switchTimeoutRef.current)
    }

    setSelectedRange(null)
    setShowCommentInput(false)
    setIsSwitching(true)

    startTransition(() => {
      setSelectedFileIndex(index)
    })

    // Ensure minimum visible duration of 150ms for visual feedback
    switchTimeoutRef.current = setTimeout(() => {
      setIsSwitching(false)
    }, 150)
  }, [])

  // Keyboard navigation for file list
  useEffect(() => {
    if (!diffRequest || flattenedFiles.length === 0) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if user is typing in an input
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        if (switchTimeoutRef.current) clearTimeout(switchTimeoutRef.current)
        setSelectedRange(null)
        setShowCommentInput(false)
        setIsSwitching(true)
        startTransition(() => {
          setSelectedFileIndex(i => Math.min(i + 1, flattenedFiles.length - 1))
        })
        switchTimeoutRef.current = setTimeout(() => setIsSwitching(false), 150)
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        if (switchTimeoutRef.current) clearTimeout(switchTimeoutRef.current)
        setSelectedRange(null)
        setShowCommentInput(false)
        setIsSwitching(true)
        startTransition(() => {
          setSelectedFileIndex(i => Math.max(i - 1, 0))
        })
        switchTimeoutRef.current = setTimeout(() => setIsSwitching(false), 150)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [diffRequest, flattenedFiles.length])

  // Scroll selected file into view in sidebar
  useEffect(() => {
    const list = fileListRef.current
    if (!list) return

    const selectedItem = list.querySelector(
      `[data-index="${selectedFileIndex}"]`
    )
    selectedItem?.scrollIntoView({ block: 'nearest' })
  }, [selectedFileIndex])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (switchTimeoutRef.current) {
        clearTimeout(switchTimeoutRef.current)
      }
    }
  }, [])

  const title =
    diffRequest?.type === 'uncommitted'
      ? 'Uncommitted Changes'
      : `Changes vs ${diffRequest?.baseBranch ?? 'main'}`

  return (
    <Dialog open={!!diffRequest} onOpenChange={open => !open && onClose()}>
      <DialogContent
        ref={dialogContentRef}
        className="!w-screen !h-dvh !max-w-screen !max-h-none !rounded-none p-0 sm:!w-[calc(100vw-4rem)] sm:!max-w-[calc(100vw-4rem)] sm:!h-[85vh] sm:!rounded-lg sm:p-4 bg-background/95 backdrop-blur-sm overflow-hidden flex flex-col"
        style={{ fontSize: 'var(--ui-font-size)' }}
        onOpenAutoFocus={(e) => {
          // Prevent Radix from focusing the first focusable element (a tooltip trigger button),
          // which would cause the tooltip to open immediately on modal open
          e.preventDefault()
          dialogContentRef.current?.focus()
        }}
        onEscapeKeyDown={(e) => {
          if (showCommentInput) {
            e.preventDefault()
            handleCancelComment()
          } else {
            e.preventDefault()
            onClose()
          }
        }}
      >
        <DialogTitle className="flex items-center gap-2 shrink-0">
          <FileText className="h-4 w-4" />
          {title}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => diffRequest && loadDiff(diffRequest, true)}
                disabled={isLoading}
                className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>Refresh diff</TooltipContent>
          </Tooltip>
          <div className="flex items-center gap-3">
            {diff && (
              <span className="text-muted-foreground font-normal text-xs">
                {diff.files.length} file{diff.files.length !== 1 ? 's' : ''}{' '}
                changed
                {diff.total_additions > 0 && (
                  <span className="text-green-500 ml-2">
                    +{diff.total_additions}
                  </span>
                )}
                {diff.total_deletions > 0 && (
                  <span className="text-red-500 ml-1">
                    -{diff.total_deletions}
                  </span>
                )}
              </span>
            )}
            {/* View mode toggle */}
            <div className="flex items-center bg-muted rounded-lg p-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setDiffStyle('split')}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors',
                      diffStyle === 'split'
                        ? 'bg-background shadow-sm text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Columns2 className="h-3.5 w-3.5" />
                    Split
                  </button>
                </TooltipTrigger>
                <TooltipContent>Side-by-side view</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setDiffStyle('unified')}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors',
                      diffStyle === 'unified'
                        ? 'bg-background shadow-sm text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Rows3 className="h-3.5 w-3.5" />
                    Stacked
                  </button>
                </TooltipTrigger>
                <TooltipContent>Unified view</TooltipContent>
              </Tooltip>
            </div>
            {/* Execute and Edit buttons */}
            {comments.length > 0 && (onAddToPrompt || onExecutePrompt) && (
              <div className="flex items-center gap-1">
                {onExecutePrompt && (
                  <button
                    type="button"
                    onClick={handleExecutePrompt}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-black text-white dark:bg-yellow-500 dark:text-black hover:bg-black/80 dark:hover:bg-yellow-400 rounded-md text-xs font-medium transition-colors"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Execute ({comments.length})
                  </button>
                )}
                {onAddToPrompt && (
                  <button
                    type="button"
                    onClick={handleAddToPrompt}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-black text-white dark:bg-yellow-500 dark:text-black hover:bg-black/80 dark:hover:bg-yellow-400 rounded-md text-xs font-medium transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Add to prompt
                  </button>
                )}
              </div>
            )}
          </div>
        </DialogTitle>

        {/* Comment bar - above sidebar and main content */}
        {hasFiles && (
          <div className="mt-2 shrink-0">
            {/* Hint when no selection */}
            {!selectedRange && comments.length === 0 && (
              <div className="flex items-center gap-2 px-3 h-10 text-muted-foreground">
                <MessageSquarePlus className="h-4 w-4 shrink-0" />
                <span className="text-sm">
                  Click on line numbers to select code and add comments
                </span>
              </div>
            )}
            {/* Comment input bar */}
            {showCommentInput && (
              <CommentInputBar
                activeFileName={activeFileName}
                selectedRange={selectedRange}
                onAddComment={handleAddComment}
                onCancel={handleCancelComment}
              />
            )}
          </div>
        )}

        {/* Empty state - centered across full modal */}
        {diff && !hasFiles && !isLoading && !error && (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            No changes to display
          </div>
        )}

        {/* Loading state - centered across full modal */}
        {isLoading && !hasFiles && (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading diff...
          </div>
        )}

        {/* Error state - centered across full modal */}
        {error && !isLoading && (
          <div className="flex flex-1 items-center justify-center">
            <div className="flex items-center gap-2 py-4 px-3 bg-destructive/10 text-destructive rounded-md">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          </div>
        )}

        {/* Flex container fills remaining space - only render when we have files */}
        {hasFiles && (
          <div className="flex flex-1 min-h-0 mt-2 gap-0">
            {/* File sidebar */}
            <div
              ref={fileListRef}
              className={cn(
                'w-64 shrink-0 overflow-y-auto transition-opacity duration-150',
                (isSwitching || isLoading) && 'opacity-60'
              )}
            >
              <div>
                {flattenedFiles.map((file, index) => {
                  const isSelected = index === selectedFileIndex
                  const displayName = getFilename(file.fileName)

                  return (
                    <Tooltip key={file.key}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          data-index={index}
                          onClick={() => handleSelectFile(index)}
                          className={cn(
                            'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors',
                            'hover:bg-muted/50',
                            isSelected && 'bg-accent'
                          )}
                        >
                          <FileText
                            className={cn(
                              'h-[1em] w-[1em] shrink-0',
                              getStatusColor(file.fileDiff.type)
                            )}
                          />
                          <span className="truncate flex-1">{displayName}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            {file.additions > 0 && (
                              <span className="text-green-500">
                                +{file.additions}
                              </span>
                            )}
                            {file.deletions > 0 && (
                              <span className="text-red-500">
                                -{file.deletions}
                              </span>
                            )}
                          </div>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{file.fileName}</TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            </div>

            {/* Main content area */}
            <div
              ref={scrollContainerRef}
              className={cn(
                'flex-1 min-w-0 overflow-y-auto transition-opacity duration-150',
                (isSwitching || isLoading) && 'opacity-60'
              )}
            >
              {selectedFile ? (
                <div className="px-2">
                  <MemoizedFileDiff
                    key={selectedFile.key}
                    fileDiff={selectedFile.fileDiff}
                    fileName={selectedFile.fileName}
                    annotations={getAnnotationsForFile(selectedFile.fileName)}
                    selectedLines={
                      activeFileName === selectedFile.fileName
                        ? selectedRange
                        : null
                    }
                    themeType={resolvedThemeType}
                    syntaxThemeDark={
                      preferences?.syntax_theme_dark ?? 'vitesse-black'
                    }
                    syntaxThemeLight={
                      preferences?.syntax_theme_light ?? 'github-light'
                    }
                    diffStyle={diffStyle}
                    onLineSelected={getLineSelectedCallback(
                      selectedFile.fileName
                    )}
                    onRemoveComment={handleRemoveComment}
                  />
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  Select a file to view its diff
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
