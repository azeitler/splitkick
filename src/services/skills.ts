import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { logger } from '@/lib/logger'
import type { ClaudeSkill, ClaudeCommand } from '@/types/chat'
import type { CliBackend } from '@/types/preferences'
import { isTauri } from '@/services/projects'

export const skillQueryKeys = {
  all: ['cli-skills'] as const,
  claudeSkills: (worktreePath?: string | null) =>
    [...skillQueryKeys.all, 'claude', 'skills', worktreePath ?? 'global'] as const,
  claudeCommands: (worktreePath?: string | null) =>
    [...skillQueryKeys.all, 'claude', 'commands', worktreePath ?? 'global'] as const,
  codexSkills: () => [...skillQueryKeys.all, 'codex', 'skills'] as const,
}

export function useClaudeSkills(worktreePath?: string | null) {
  return useQuery({
    queryKey: skillQueryKeys.claudeSkills(worktreePath),
    queryFn: async (): Promise<ClaudeSkill[]> => {
      if (!isTauri()) return []

      try {
        logger.debug('Loading Claude CLI skills')
        const skills = await invoke<ClaudeSkill[]>('list_claude_skills', {
          worktreePath: worktreePath ?? undefined,
        })
        logger.info('Claude CLI skills loaded', { count: skills.length })
        return skills
      } catch (error) {
        logger.error('Failed to load Claude CLI skills', { error })
        return []
      }
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  })
}

export function useClaudeCommands(worktreePath?: string | null) {
  return useQuery({
    queryKey: skillQueryKeys.claudeCommands(worktreePath),
    queryFn: async (): Promise<ClaudeCommand[]> => {
      if (!isTauri()) return []

      try {
        logger.debug('Loading Claude CLI custom commands')
        const commands = await invoke<ClaudeCommand[]>('list_claude_commands', {
          worktreePath: worktreePath ?? undefined,
        })
        logger.info('Claude CLI custom commands loaded', {
          count: commands.length,
        })
        return commands
      } catch (error) {
        logger.error('Failed to load Claude CLI custom commands', { error })
        return []
      }
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  })
}

export function useCodexSkills() {
  return useQuery({
    queryKey: skillQueryKeys.codexSkills(),
    queryFn: async (): Promise<ClaudeSkill[]> => {
      if (!isTauri()) return []

      try {
        logger.debug('Loading Codex CLI skills')
        const skills = await invoke<ClaudeSkill[]>('list_codex_skills', {})
        logger.info('Codex CLI skills loaded', { count: skills.length })
        return skills
      } catch (error) {
        logger.error('Failed to load Codex CLI skills', { error })
        return []
      }
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  })
}

export interface BackendSkillsGroup {
  backend: CliBackend
  label: string
  skills: ClaudeSkill[]
  commands: ClaudeCommand[]
}

export function useAllBackendSkills(
  worktreePath?: string | null,
  installedBackends?: CliBackend[]
): BackendSkillsGroup[] {
  const claudeSkills = useClaudeSkills(worktreePath)
  const claudeCommands = useClaudeCommands(worktreePath)
  const codexSkills = useCodexSkills()

  return useMemo(() => {
    const groups: BackendSkillsGroup[] = []
    const installed = new Set(installedBackends ?? [])

    if (installed.has('claude')) {
      const skills = claudeSkills.data ?? []
      const commands = claudeCommands.data ?? []
      if (skills.length > 0 || commands.length > 0) {
        groups.push({ backend: 'claude', label: 'Claude', skills, commands })
      }
    }

    if (installed.has('codex')) {
      const skills = codexSkills.data ?? []
      if (skills.length > 0) {
        groups.push({ backend: 'codex', label: 'Codex', skills, commands: [] })
      }
    }

    return groups
  }, [
    claudeSkills.data,
    claudeCommands.data,
    codexSkills.data,
    installedBackends,
  ])
}
