import { useCallback, useEffect } from 'react'
import type { TabId } from '../NewWorktreeModal'
import type { GitHubIssue, GitHubPullRequest } from '@/types/github'

interface Params {
  activeTab: TabId
  setActiveTab: (tab: TabId) => void
  filteredIssues: GitHubIssue[]
  filteredPRs: GitHubPullRequest[]
  filteredBranches: string[]
  selectedItemIndex: number
  setSelectedItemIndex: (i: number | ((prev: number) => number)) => void
  creatingFromNumber: number | null
  handleCreateWorktree: () => void
  handleBaseSession: () => void
  handleSelectIssue: (issue: GitHubIssue, background?: boolean) => void
  handleSelectIssueAndInvestigate: (
    issue: GitHubIssue,
    background?: boolean
  ) => void
  handlePreviewIssue: (issue: GitHubIssue) => void
  handleSelectPR: (pr: GitHubPullRequest, background?: boolean) => void
  handleSelectPRAndInvestigate: (
    pr: GitHubPullRequest,
    background?: boolean
  ) => void
  handlePreviewPR: (pr: GitHubPullRequest) => void
  handleSelectBranch: (branchName: string, background?: boolean) => void
}

export function useNewWorktreeKeyboard({
  activeTab,
  setActiveTab,
  filteredIssues,
  filteredPRs,
  filteredBranches,
  selectedItemIndex,
  setSelectedItemIndex,
  creatingFromNumber,
  handleCreateWorktree,
  handleBaseSession,
  handleSelectIssue,
  handleSelectIssueAndInvestigate,
  handlePreviewIssue,
  handleSelectPR,
  handleSelectPRAndInvestigate,
  handlePreviewPR,
  handleSelectBranch,
}: Params) {
  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = document.querySelector(
      `[data-item-index="${selectedItemIndex}"]`
    )
    selectedElement?.scrollIntoView({ block: 'nearest' })
  }, [selectedItemIndex])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const key = e.key.toLowerCase()

      // Tab shortcuts (Cmd+key)
      if (e.metaKey || e.ctrlKey) {
        if (key === '1') {
          e.preventDefault()
          setActiveTab('quick')
          return
        }
        if (key === '2') {
          e.preventDefault()
          setActiveTab('issues')
          return
        }
        if (key === '3') {
          e.preventDefault()
          setActiveTab('prs')
          return
        }
        if (key === '4') {
          e.preventDefault()
          setActiveTab('branches')
          return
        }
      }

      // Quick actions shortcuts
      if (activeTab === 'quick') {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          if (key === 'n') {
            e.preventDefault()
            e.nativeEvent.stopImmediatePropagation()
            handleCreateWorktree()
            return
          }
          if (key === 'm') {
            e.preventDefault()
            e.nativeEvent.stopImmediatePropagation()
            handleBaseSession()
            return
          }
        }
      }

      // Issues tab navigation
      if (activeTab === 'issues' && filteredIssues.length > 0) {
        if (key === 'arrowdown') {
          e.preventDefault()
          setSelectedItemIndex((prev: number) =>
            Math.min(prev + 1, filteredIssues.length - 1)
          )
          return
        }
        if (key === 'arrowup') {
          e.preventDefault()
          setSelectedItemIndex((prev: number) => Math.max(prev - 1, 0))
          return
        }
        if (key === 'enter' && filteredIssues[selectedItemIndex]) {
          e.preventDefault()
          handleSelectIssue(filteredIssues[selectedItemIndex], e.metaKey)
          return
        }
        if (
          key === 'o' &&
          (e.metaKey || e.ctrlKey) &&
          filteredIssues[selectedItemIndex]
        ) {
          e.preventDefault()
          e.nativeEvent.stopImmediatePropagation()
          handlePreviewIssue(filteredIssues[selectedItemIndex])
          return
        }
        if (
          key === 'm' &&
          (e.metaKey || e.ctrlKey) &&
          filteredIssues[selectedItemIndex] &&
          creatingFromNumber === null
        ) {
          e.preventDefault()
          e.nativeEvent.stopImmediatePropagation()
          handleSelectIssueAndInvestigate(
            filteredIssues[selectedItemIndex],
            e.metaKey || e.ctrlKey
          )
          return
        }
      }

      // PRs tab navigation
      if (activeTab === 'prs' && filteredPRs.length > 0) {
        if (key === 'arrowdown') {
          e.preventDefault()
          setSelectedItemIndex((prev: number) =>
            Math.min(prev + 1, filteredPRs.length - 1)
          )
          return
        }
        if (key === 'arrowup') {
          e.preventDefault()
          setSelectedItemIndex((prev: number) => Math.max(prev - 1, 0))
          return
        }
        if (key === 'enter' && filteredPRs[selectedItemIndex]) {
          e.preventDefault()
          handleSelectPR(filteredPRs[selectedItemIndex], e.metaKey)
          return
        }
        if (
          key === 'o' &&
          (e.metaKey || e.ctrlKey) &&
          filteredPRs[selectedItemIndex]
        ) {
          e.preventDefault()
          e.nativeEvent.stopImmediatePropagation()
          handlePreviewPR(filteredPRs[selectedItemIndex])
          return
        }
        if (
          key === 'm' &&
          (e.metaKey || e.ctrlKey) &&
          filteredPRs[selectedItemIndex] &&
          creatingFromNumber === null
        ) {
          e.preventDefault()
          e.nativeEvent.stopImmediatePropagation()
          handleSelectPRAndInvestigate(
            filteredPRs[selectedItemIndex],
            e.metaKey || e.ctrlKey
          )
          return
        }
      }

      // Branches tab navigation
      if (activeTab === 'branches' && filteredBranches.length > 0) {
        if (key === 'arrowdown') {
          e.preventDefault()
          setSelectedItemIndex((prev: number) =>
            Math.min(prev + 1, filteredBranches.length - 1)
          )
          return
        }
        if (key === 'arrowup') {
          e.preventDefault()
          setSelectedItemIndex((prev: number) => Math.max(prev - 1, 0))
          return
        }
        if (key === 'enter' && filteredBranches[selectedItemIndex]) {
          e.preventDefault()
          handleSelectBranch(filteredBranches[selectedItemIndex], e.metaKey)
          return
        }
      }
    },
    [
      activeTab,
      filteredIssues,
      filteredPRs,
      filteredBranches,
      selectedItemIndex,
      handleCreateWorktree,
      handleBaseSession,
      handleSelectIssue,
      handleSelectIssueAndInvestigate,
      handlePreviewIssue,
      handleSelectPR,
      handleSelectPRAndInvestigate,
      handlePreviewPR,
      handleSelectBranch,
      creatingFromNumber,
      setActiveTab,
      setSelectedItemIndex,
    ]
  )

  return { handleKeyDown }
}
