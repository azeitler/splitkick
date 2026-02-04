import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import { useSessions, useCreateSession } from '@/services/chat'
import { useWorktree, useProjects } from '@/services/projects'
import { isBaseSession } from '@/types/projects'
import { computeSessionCardData } from './session-card-utils'
import { useCanvasStoreState } from './hooks/useCanvasStoreState'
import { usePlanApproval } from './hooks/usePlanApproval'
import { useSessionArchive } from './hooks/useSessionArchive'
import { CanvasGrid } from './CanvasGrid'
import { KeybindingHints } from '@/components/ui/keybinding-hints'
import { usePreferences } from '@/services/preferences'
import { DEFAULT_KEYBINDINGS } from '@/types/keybindings'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface SessionCanvasViewProps {
  worktreeId: string
  worktreePath: string
}

export function SessionCanvasView({
  worktreeId,
  worktreePath,
}: SessionCanvasViewProps) {
  const { data: sessionsData } = useSessions(worktreeId, worktreePath)

  // Project and worktree info for title display
  const { data: worktree } = useWorktree(worktreeId)
  const { data: projects } = useProjects()
  const project = worktree
    ? projects?.find(p => p.id === worktree.project_id)
    : null
  const sessionLabel =
    worktree && isBaseSession(worktree) ? 'base' : worktree?.name

  // Preferences for keybinding hints
  const { data: preferences } = usePreferences()

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Selection state
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  )

  // Use shared hooks
  const storeState = useCanvasStoreState()
  const { handlePlanApproval, handlePlanApprovalYolo } = usePlanApproval({
    worktreeId,
    worktreePath,
  })
  const { handleArchiveSession, handleDeleteSession } = useSessionArchive({
    worktreeId,
    worktreePath,
    sessions: sessionsData?.sessions,
    worktree,
    project,
  })

  // Session creation
  const createSession = useCreateSession()

  // Actions via getState()
  const { setActiveSession, setViewingCanvasTab } = useChatStore.getState()

  // Listen for open-session-modal event (used when creating new session in canvas-only mode)
  useEffect(() => {
    const handleOpenSessionModal = (e: CustomEvent<{ sessionId: string }>) => {
      setSelectedSessionId(e.detail.sessionId)
    }

    window.addEventListener(
      'open-session-modal',
      handleOpenSessionModal as EventListener
    )
    return () =>
      window.removeEventListener(
        'open-session-modal',
        handleOpenSessionModal as EventListener
      )
  }, [])

  // When sessions load for a newly created worktree, auto-open the first session modal
  useEffect(() => {
    if (!sessionsData?.sessions?.length) return

    const shouldAutoOpen = useUIStore
      .getState()
      .consumeAutoOpenSession(worktreeId)
    if (!shouldAutoOpen) return

    const firstSession = sessionsData.sessions[0]
    if (firstSession) {
      setSelectedSessionId(firstSession.id)
    }
  }, [worktreeId, sessionsData?.sessions])

  // Listen for create-new-session event to handle Cmd+T
  useEffect(() => {
    const handleCreateNewSession = () => {
      console.log('[SessionCanvasView] handleCreateNewSession called')
      console.log('[SessionCanvasView] selectedSessionId:', selectedSessionId)
      // Don't create if modal is already open
      if (selectedSessionId) return

      createSession.mutate(
        { worktreeId, worktreePath },
        {
          onSuccess: session => {
            console.log('[SessionCanvasView] onSuccess - session.id:', session.id)
            setSelectedSessionId(session.id)
            // selectedIndex will be synced reactively by the effect below
          },
        }
      )
    }

    window.addEventListener('create-new-session', handleCreateNewSession)
    return () =>
      window.removeEventListener('create-new-session', handleCreateNewSession)
  }, [worktreeId, worktreePath, selectedSessionId, createSession])

  // Compute session card data (must be before effects that depend on it)
  const sessionCards = useMemo(() => {
    const sessions = sessionsData?.sessions ?? []
    console.log('[SessionCanvasView] sessionCards useMemo - sessions count:', sessions.length)
    console.log('[SessionCanvasView] sessionCards useMemo - first session id:', sessions[0]?.id)
    const cards = sessions.map(session =>
      computeSessionCardData(session, storeState)
    )

    // Filter by search query
    if (!searchQuery.trim()) return cards
    const q = searchQuery.toLowerCase()
    return cards.filter(card => card.session.name?.toLowerCase().includes(q))
  }, [sessionsData?.sessions, storeState, searchQuery])

  // Sync selectedIndex when selectedSessionId changes and sessionCards updates
  useEffect(() => {
    if (!selectedSessionId) return
    const cardIndex = sessionCards.findIndex(
      card => card.session.id === selectedSessionId
    )
    console.log('[SessionCanvasView] sync selectedIndex - cardIndex:', cardIndex, 'for session:', selectedSessionId)
    if (cardIndex !== -1 && cardIndex !== selectedIndex) {
      setSelectedIndex(cardIndex)
    }
  }, [selectedSessionId, sessionCards, selectedIndex])

  // Debug: log selectedIndex changes
  console.log('[SessionCanvasView] render - selectedIndex:', selectedIndex, 'sessionCards.length:', sessionCards.length)

  // Handle opening full view from modal
  const handleOpenFullView = useCallback(() => {
    if (selectedSessionId) {
      setViewingCanvasTab(worktreeId, false)
      setActiveSession(worktreeId, selectedSessionId)
      setSelectedSessionId(null)
    }
  }, [worktreeId, selectedSessionId, setViewingCanvasTab, setActiveSession])

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex-1 flex flex-col overflow-auto">
        {/* Header with Search - sticky over content */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 bg-background/60 backdrop-blur-md px-4 py-3 border-b border-border/30">
        <h2 className="text-lg font-semibold shrink-0">
          {project?.name}
          {sessionLabel && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({sessionLabel})
            </span>
          )}
        </h2>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9 bg-transparent border-border/30"
          />
        </div>
        <span className="text-sm text-muted-foreground shrink-0">
          {sessionCards.length} session{sessionCards.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Canvas View */}
      <div className="flex-1 pb-16 pt-6 px-4">
        {sessionCards.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            {searchQuery ? 'No sessions match your search' : 'No sessions yet'}
          </div>
        ) : (
          <CanvasGrid
            cards={sessionCards}
            worktreeId={worktreeId}
            worktreePath={worktreePath}
            selectedIndex={selectedIndex}
            onSelectedIndexChange={setSelectedIndex}
            selectedSessionId={selectedSessionId}
            onSelectedSessionIdChange={setSelectedSessionId}
            onOpenFullView={handleOpenFullView}
            onArchiveSession={handleArchiveSession}
            onDeleteSession={handleDeleteSession}
            onPlanApproval={handlePlanApproval}
            onPlanApprovalYolo={handlePlanApprovalYolo}
            searchInputRef={searchInputRef}
          />
        )}
      </div>
      </div>

      {/* Keybinding hints */}
      {preferences?.show_keybinding_hints !== false && (
        <KeybindingHints
          hints={[
            { shortcut: 'Enter', label: 'open' },
            { shortcut: 'P', label: 'plan' },
            { shortcut: 'R', label: 'recap' },
            { shortcut: DEFAULT_KEYBINDINGS.new_worktree as string, label: 'new worktree' },
            { shortcut: DEFAULT_KEYBINDINGS.new_session as string, label: 'new session' },
            { shortcut: DEFAULT_KEYBINDINGS.close_session_or_worktree as string, label: 'close' },
          ]}
        />
      )}
    </div>
  )
}
