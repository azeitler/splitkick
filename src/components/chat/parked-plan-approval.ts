import type { EffortLevel, ThinkingLevel } from '@/types/chat'

/**
 * Tool result for a parked Claude plan that is approved with other run
 * settings: the approval follows as a new turn, so this one must stop.
 */
export const PLAN_CONTINUES_IN_NEW_TURN =
  'The user approved the plan. Splitkick runs it in a new turn with other model settings. Do not start the work in this turn: end your turn now with one short sentence and call no more tools.'

/** The message that starts an approved plan's new turn. */
export function planApprovalMessage(mode: 'build' | 'yolo'): string {
  return mode === 'yolo'
    ? 'Plan approved (yolo mode). Begin implementing all changes immediately without asking for confirmation. Do not re-explain the plan — start writing code.'
    : 'Plan approved. Begin implementing the changes now. Do not re-explain the plan — start writing code.'
}

const THINKING_LEVELS = new Set<string>([
  'off',
  'adaptive',
  'think',
  'megathink',
  'ultrathink',
])

interface RunSettings {
  model: string
  thinkingLevel: ThinkingLevel
  effortLevel?: EffortLevel
}

interface ApprovalOverrides {
  backend: string | null
  model: string | null
  thinkingLevel: string | null
  effortLevel: string | null
}

/**
 * Settings the approved plan runs with, from the build/yolo overrides (same
 * rules as the new-turn approval: an override for another backend does not
 * apply). `needsNewTurn` is true when they differ from the parked run's, which
 * cannot change model, thinking or effort mid-turn.
 */
export function resolveApprovalRunSettings(
  sessionBackend: string | null,
  current: RunSettings,
  overrides: ApprovalOverrides,
  adaptiveThinking: boolean
): RunSettings & { needsNewTurn: boolean } {
  const apply = !overrides.backend || overrides.backend === sessionBackend
  const model = apply ? (overrides.model ?? current.model) : current.model
  const thinkingLevel =
    apply &&
    overrides.thinkingLevel &&
    THINKING_LEVELS.has(overrides.thinkingLevel)
      ? (overrides.thinkingLevel as ThinkingLevel)
      : current.thinkingLevel
  const effortLevel = adaptiveThinking
    ? apply && overrides.effortLevel
      ? (overrides.effortLevel as EffortLevel)
      : current.effortLevel
    : undefined
  const needsNewTurn =
    model !== current.model ||
    thinkingLevel !== current.thinkingLevel ||
    effortLevel !== current.effortLevel
  return { model, thinkingLevel, effortLevel, needsNewTurn }
}
