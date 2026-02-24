import { useCallback, useState } from 'react'
import { invoke } from '@/lib/transport'
import { toast } from 'sonner'
import { useUIStore } from '@/store/ui-store'
import { useProjectsStore } from '@/store/projects-store'
import { useChatStore } from '@/store/chat-store'
import { githubQueryKeys } from '@/services/github'
import { projectsQueryKeys } from '@/services/projects'
import type {
  GitHubIssue,
  GitHubPullRequest,
  IssueContext,
  PullRequestContext,
} from '@/types/github'
import type { useNewWorktreeData } from './useNewWorktreeData'
import type { TabId } from '../NewWorktreeModal'

type Data = ReturnType<typeof useNewWorktreeData>

interface Setters {
  setActiveTab: (tab: TabId) => void
  setSearchQuery: (q: string) => void
  setSelectedItemIndex: (i: number) => void
  setIncludeClosed: (v: boolean) => void
}

export function useNewWorktreeHandlers(data: Data, setters: Setters) {
  const {
    queryClient,
    selectedProjectId,
    selectedProject,
    hasBaseSession,
    baseSession,
    createWorktree,
    createBaseSession,
    createWorktreeFromBranch,
  } = data

  const { setActiveTab, setSearchQuery, setSelectedItemIndex, setIncludeClosed } =
    setters

  // In-flight state
  const [creatingFromNumber, setCreatingFromNumber] = useState<number | null>(
    null
  )
  const [creatingFromBranch, setCreatingFromBranch] = useState<string | null>(
    null
  )

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setCreatingFromNumber(null)
      setCreatingFromBranch(null)
      setSearchQuery('')
      setSelectedItemIndex(0)

      if (open) {
        const { newWorktreeModalDefaultTab, setNewWorktreeModalDefaultTab } =
          useUIStore.getState()
        setActiveTab(
          newWorktreeModalDefaultTab ?? (selectedProjectId ? 'issues' : 'quick')
        )
        setNewWorktreeModalDefaultTab(null)
        setIncludeClosed(false)

        // Invalidate caches
        const projectPath = selectedProject?.path
        if (projectPath) {
          queryClient.invalidateQueries({
            queryKey: githubQueryKeys.issues(projectPath, 'open'),
          })
          queryClient.invalidateQueries({
            queryKey: githubQueryKeys.issues(projectPath, 'all'),
          })
          queryClient.invalidateQueries({
            queryKey: githubQueryKeys.prs(projectPath, 'open'),
          })
          queryClient.invalidateQueries({
            queryKey: githubQueryKeys.prs(projectPath, 'all'),
          })
        }
        if (selectedProjectId) {
          queryClient.invalidateQueries({
            queryKey: [
              ...projectsQueryKeys.detail(selectedProjectId),
              'branches',
            ],
          })
        }
      }
      useUIStore.getState().setNewWorktreeModalOpen(open)
    },
    [
      selectedProject,
      queryClient,
      selectedProjectId,
      setActiveTab,
      setSearchQuery,
      setSelectedItemIndex,
      setIncludeClosed,
    ]
  )

  const handleCreateWorktree = useCallback(() => {
    if (!selectedProjectId) {
      toast.error('No project selected')
      return
    }
    createWorktree.mutate({ projectId: selectedProjectId })
    handleOpenChange(false)
  }, [selectedProjectId, createWorktree, handleOpenChange])

  const handleBaseSession = useCallback(() => {
    if (!selectedProjectId) {
      toast.error('No project selected')
      return
    }

    if (hasBaseSession && baseSession) {
      const { selectWorktree } = useProjectsStore.getState()
      const { setActiveWorktree } = useChatStore.getState()
      selectWorktree(baseSession.id)
      setActiveWorktree(baseSession.id, baseSession.path)
      toast.success(`Switched to base session: ${baseSession.name}`)
    } else {
      createBaseSession.mutate(selectedProjectId)
    }
    handleOpenChange(false)
  }, [
    selectedProjectId,
    hasBaseSession,
    baseSession,
    createBaseSession,
    handleOpenChange,
  ])

  const handleSelectBranch = useCallback(
    (branchName: string, background = false) => {
      if (!selectedProjectId) {
        toast.error('No project selected')
        return
      }
      setCreatingFromBranch(branchName)
      if (background)
        useUIStore.getState().incrementPendingBackgroundCreations()
      createWorktreeFromBranch.mutate(
        { projectId: selectedProjectId, branchName, background },
        {
          onError: () => setCreatingFromBranch(null),
          onSuccess: () => {
            if (background) setCreatingFromBranch(null)
          },
        }
      )
      if (!background) handleOpenChange(false)
    },
    [selectedProjectId, createWorktreeFromBranch, handleOpenChange]
  )

  const handleSelectIssue = useCallback(
    async (issue: GitHubIssue, background = false) => {
      const projectPath = selectedProject?.path
      if (!selectedProjectId || !projectPath) {
        toast.error('No project selected')
        return
      }

      setCreatingFromNumber(issue.number)

      try {
        const issueDetail = await invoke<
          GitHubIssue & {
            comments: {
              body: string
              author: { login: string }
              created_at: string
            }[]
          }
        >('get_github_issue', {
          projectPath,
          issueNumber: issue.number,
        })

        const issueContext: IssueContext = {
          number: issueDetail.number,
          title: issueDetail.title,
          body: issueDetail.body,
          comments: (issueDetail.comments ?? [])
            .filter(c => c && c.created_at && c.author)
            .map(c => ({
              body: c.body ?? '',
              author: { login: c.author.login ?? '' },
              createdAt: c.created_at,
            })),
        }

        if (background)
          useUIStore.getState().incrementPendingBackgroundCreations()
        createWorktree.mutate({
          projectId: selectedProjectId,
          issueContext,
          background,
        })

        if (background) {
          setCreatingFromNumber(null)
        } else {
          handleOpenChange(false)
        }
      } catch (error) {
        toast.error(`Failed to fetch issue details: ${error}`)
        setCreatingFromNumber(null)
      }
    },
    [selectedProjectId, selectedProject, createWorktree, handleOpenChange]
  )

  const handleSelectIssueAndInvestigate = useCallback(
    async (issue: GitHubIssue, background = false) => {
      const projectPath = selectedProject?.path
      if (!selectedProjectId || !projectPath) {
        toast.error('No project selected')
        return
      }

      setCreatingFromNumber(issue.number)

      try {
        const issueDetail = await invoke<
          GitHubIssue & {
            comments: {
              body: string
              author: { login: string }
              created_at: string
            }[]
          }
        >('get_github_issue', {
          projectPath,
          issueNumber: issue.number,
        })

        const issueContext: IssueContext = {
          number: issueDetail.number,
          title: issueDetail.title,
          body: issueDetail.body,
          comments: (issueDetail.comments ?? [])
            .filter(c => c && c.created_at && c.author)
            .map(c => ({
              body: c.body ?? '',
              author: { login: c.author.login ?? '' },
              createdAt: c.created_at,
            })),
        }

        if (background)
          useUIStore.getState().incrementPendingBackgroundCreations()

        const worktree = await createWorktree.mutateAsync({
          projectId: selectedProjectId,
          issueContext,
          background,
        })
        useUIStore.getState().markWorktreeForAutoInvestigate(worktree.id)

        if (background) {
          setCreatingFromNumber(null)
        } else {
          handleOpenChange(false)
        }
      } catch (error) {
        toast.error(`Failed to fetch issue details: ${error}`)
        setCreatingFromNumber(null)
      }
    },
    [selectedProjectId, selectedProject, createWorktree, handleOpenChange]
  )

  const handleSelectPR = useCallback(
    async (pr: GitHubPullRequest, background = false) => {
      const projectPath = selectedProject?.path
      if (!selectedProjectId || !projectPath) {
        toast.error('No project selected')
        return
      }

      setCreatingFromNumber(pr.number)

      try {
        const prDetail = await invoke<
          GitHubPullRequest & {
            comments: {
              body: string
              author: { login: string }
              created_at: string
            }[]
            reviews: {
              body: string
              state: string
              author: { login: string }
              submittedAt?: string
            }[]
          }
        >('get_github_pr', {
          projectPath,
          prNumber: pr.number,
        })

        const prContext: PullRequestContext = {
          number: prDetail.number,
          title: prDetail.title,
          body: prDetail.body,
          headRefName: prDetail.headRefName,
          baseRefName: prDetail.baseRefName,
          comments: (prDetail.comments ?? [])
            .filter(c => c && c.created_at && c.author)
            .map(c => ({
              body: c.body ?? '',
              author: { login: c.author.login ?? '' },
              createdAt: c.created_at,
            })),
          reviews: (prDetail.reviews ?? [])
            .filter(r => r && r.author)
            .map(r => ({
              body: r.body ?? '',
              state: r.state,
              author: { login: r.author.login ?? '' },
              submittedAt: r.submittedAt,
            })),
        }

        if (background)
          useUIStore.getState().incrementPendingBackgroundCreations()
        createWorktree.mutate({
          projectId: selectedProjectId,
          prContext,
          background,
        })

        if (background) {
          setCreatingFromNumber(null)
        } else {
          handleOpenChange(false)
        }
      } catch (error) {
        toast.error(`Failed to fetch PR details: ${error}`)
        setCreatingFromNumber(null)
      }
    },
    [selectedProjectId, selectedProject, createWorktree, handleOpenChange]
  )

  const handleSelectPRAndInvestigate = useCallback(
    async (pr: GitHubPullRequest, background = false) => {
      const projectPath = selectedProject?.path
      if (!selectedProjectId || !projectPath) {
        toast.error('No project selected')
        return
      }

      setCreatingFromNumber(pr.number)

      try {
        const prDetail = await invoke<
          GitHubPullRequest & {
            comments: {
              body: string
              author: { login: string }
              created_at: string
            }[]
            reviews: {
              body: string
              state: string
              author: { login: string }
              submittedAt?: string
            }[]
          }
        >('get_github_pr', {
          projectPath,
          prNumber: pr.number,
        })

        const prContext: PullRequestContext = {
          number: prDetail.number,
          title: prDetail.title,
          body: prDetail.body,
          headRefName: prDetail.headRefName,
          baseRefName: prDetail.baseRefName,
          comments: (prDetail.comments ?? [])
            .filter(c => c && c.created_at && c.author)
            .map(c => ({
              body: c.body ?? '',
              author: { login: c.author.login ?? '' },
              createdAt: c.created_at,
            })),
          reviews: (prDetail.reviews ?? [])
            .filter(r => r && r.author)
            .map(r => ({
              body: r.body ?? '',
              state: r.state,
              author: { login: r.author.login ?? '' },
              submittedAt: r.submittedAt,
            })),
        }

        if (background)
          useUIStore.getState().incrementPendingBackgroundCreations()

        const worktree = await createWorktree.mutateAsync({
          projectId: selectedProjectId,
          prContext,
          background,
        })
        useUIStore.getState().markWorktreeForAutoInvestigatePR(worktree.id)

        if (background) {
          setCreatingFromNumber(null)
        } else {
          handleOpenChange(false)
        }
      } catch (error) {
        toast.error(`Failed to fetch PR details: ${error}`)
        setCreatingFromNumber(null)
      }
    },
    [selectedProjectId, selectedProject, createWorktree, handleOpenChange]
  )

  return {
    creatingFromNumber,
    creatingFromBranch,
    handleOpenChange,
    handleCreateWorktree,
    handleBaseSession,
    handleSelectBranch,
    handleSelectIssue,
    handleSelectIssueAndInvestigate,
    handleSelectPR,
    handleSelectPRAndInvestigate,
  }
}
