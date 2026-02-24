import { useCallback, useEffect } from 'react'
import type { SavedContext, AllSessionsEntry } from '@/types/chat'
import type { GitHubIssue, GitHubPullRequest } from '@/types/github'
import type { SessionWithContext } from '../LoadContextItems'

type TabId = 'issues' | 'prs' | 'contexts'

interface UseLoadContextKeyboardOptions {
  activeTab: TabId
  filteredIssues: GitHubIssue[]
  filteredPRs: GitHubPullRequest[]
  filteredContexts: SavedContext[]
  filteredEntries: AllSessionsEntry[]
  selectedIndex: number
  setSelectedIndex: (i: number) => void
  onSelectIssue: (issue: GitHubIssue) => void
  onSelectPR: (pr: GitHubPullRequest) => void
  onPreviewIssue: (issue: GitHubIssue) => void
  onPreviewPR: (pr: GitHubPullRequest) => void
  onAttachContext: (ctx: SavedContext) => void
  onSessionClick: (s: SessionWithContext) => void
  onTabChange: (tab: TabId) => void
}

export function useLoadContextKeyboard({
  activeTab,
  filteredIssues,
  filteredPRs,
  filteredContexts,
  filteredEntries,
  selectedIndex,
  setSelectedIndex,
  onSelectIssue,
  onSelectPR,
  onPreviewIssue,
  onPreviewPR,
  onAttachContext,
  onSessionClick,
  onTabChange,
}: UseLoadContextKeyboardOptions) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const key = e.key.toLowerCase()

      // Tab shortcuts (Cmd+key)
      if (e.metaKey || e.ctrlKey) {
        if (key === '1') {
          e.preventDefault()
          onTabChange('contexts')
          return
        }
        if (key === '2') {
          e.preventDefault()
          onTabChange('issues')
          return
        }
        if (key === '3') {
          e.preventDefault()
          onTabChange('prs')
          return
        }
      }

      // List navigation for issues tab
      if (activeTab === 'issues' && filteredIssues.length > 0) {
        if (key === 'arrowdown') {
          e.preventDefault()
          setSelectedIndex(Math.min(selectedIndex + 1, filteredIssues.length - 1))
          return
        }
        if (key === 'arrowup') {
          e.preventDefault()
          setSelectedIndex(Math.max(selectedIndex - 1, 0))
          return
        }
        if (key === 'enter' && filteredIssues[selectedIndex]) {
          e.preventDefault()
          onSelectIssue(filteredIssues[selectedIndex])
          return
        }
        if (key === 'o' && (e.metaKey || e.ctrlKey) && filteredIssues[selectedIndex]) {
          e.preventDefault()
          e.nativeEvent.stopImmediatePropagation()
          onPreviewIssue(filteredIssues[selectedIndex])
          return
        }
      }

      // List navigation for PRs tab
      if (activeTab === 'prs' && filteredPRs.length > 0) {
        if (key === 'arrowdown') {
          e.preventDefault()
          setSelectedIndex(Math.min(selectedIndex + 1, filteredPRs.length - 1))
          return
        }
        if (key === 'arrowup') {
          e.preventDefault()
          setSelectedIndex(Math.max(selectedIndex - 1, 0))
          return
        }
        if (key === 'enter' && filteredPRs[selectedIndex]) {
          e.preventDefault()
          onSelectPR(filteredPRs[selectedIndex])
          return
        }
        if (key === 'o' && (e.metaKey || e.ctrlKey) && filteredPRs[selectedIndex]) {
          e.preventDefault()
          e.nativeEvent.stopImmediatePropagation()
          onPreviewPR(filteredPRs[selectedIndex])
          return
        }
      }

      // List navigation for contexts tab (saved contexts + sessions)
      if (activeTab === 'contexts') {
        const totalItems =
          filteredContexts.length +
          filteredEntries.reduce((acc, e) => acc + e.sessions.length, 0)
        if (totalItems > 0) {
          if (key === 'arrowdown') {
            e.preventDefault()
            setSelectedIndex(Math.min(selectedIndex + 1, totalItems - 1))
            return
          }
          if (key === 'arrowup') {
            e.preventDefault()
            setSelectedIndex(Math.max(selectedIndex - 1, 0))
            return
          }
          if (key === 'enter') {
            e.preventDefault()
            if (selectedIndex < filteredContexts.length) {
              const context = filteredContexts[selectedIndex]
              if (context) onAttachContext(context)
            } else {
              let idx = selectedIndex - filteredContexts.length
              for (const entry of filteredEntries) {
                if (idx < entry.sessions.length) {
                  const session = entry.sessions[idx]
                  if (session) {
                    onSessionClick({
                      session,
                      worktreeId: entry.worktree_id,
                      worktreePath: entry.worktree_path,
                      projectName: entry.project_name,
                    })
                  }
                  break
                }
                idx -= entry.sessions.length
              }
            }
            return
          }
        }
      }
    },
    [
      activeTab,
      filteredIssues,
      filteredPRs,
      filteredContexts,
      filteredEntries,
      selectedIndex,
      setSelectedIndex,
      onSelectIssue,
      onSelectPR,
      onPreviewIssue,
      onPreviewPR,
      onAttachContext,
      onSessionClick,
      onTabChange,
    ]
  )

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = document.querySelector(
      `[data-load-item-index="${selectedIndex}"]`
    )
    selectedElement?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  return { handleKeyDown }
}
