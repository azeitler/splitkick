import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CommandContext, AppCommand } from './types'

const mockUIStore = {
  getState: vi.fn(() => ({
    leftSidebarVisible: true,
    commandPaletteOpen: false,
    setLeftSidebarVisible: vi.fn(),
  })),
}

vi.mock('@/store/ui-store', () => ({
  useUIStore: mockUIStore,
}))

const { registerCommands, getAllCommands, executeCommand, clearRegistry } =
  await import('./registry')
const { navigationCommands } = await import('./navigation-commands')
const { executionCommands } = await import('./execution-commands')
const { modelCommands } = await import('./model-commands')
const { gitCommands } = await import('./git-commands')
const { sessionCommands } = await import('./session-commands')

const createMockContext = (): CommandContext => ({
  // Query client
  queryClient: {
    getQueryData: vi.fn(),
  } as unknown as CommandContext['queryClient'],

  // Preferences
  openPreferences: vi.fn(),

  // Notifications
  showToast: vi.fn(),

  // GitHub
  openPullRequest: vi.fn().mockResolvedValue(undefined),

  // Git
  openCommitModal: vi.fn(),
  viewGitDiff: vi.fn(),
  rebaseWorktree: vi.fn().mockResolvedValue(undefined),
  gitPull: vi.fn().mockResolvedValue(undefined),
  refreshGitStatus: vi.fn(),

  // Sessions
  createSession: vi.fn(),
  closeSession: vi.fn(),
  nextSession: vi.fn(),
  previousSession: vi.fn(),
  clearSessionHistory: vi.fn().mockResolvedValue(undefined),
  renameSession: vi.fn(),
  resumeSession: vi.fn().mockResolvedValue(undefined),

  // Worktrees
  createWorktree: vi.fn(),
  nextWorktree: vi.fn(),
  previousWorktree: vi.fn(),
  deleteWorktree: vi.fn(),
  renameWorktree: vi.fn(),

  // Open In
  openInFinder: vi.fn().mockResolvedValue(undefined),
  openInTerminal: vi.fn().mockResolvedValue(undefined),
  openInEditor: vi.fn().mockResolvedValue(undefined),
  openOnGitHub: vi.fn().mockResolvedValue(undefined),
  openOpenInModal: vi.fn(),

  // Model/Thinking
  setModel: vi.fn(),
  setThinkingLevel: vi.fn(),

  // Execution Mode
  setExecutionMode: vi.fn(),
  cycleExecutionMode: vi.fn(),

  // Theme
  setTheme: vi.fn(),

  // Focus
  focusChatInput: vi.fn(),

  // Projects
  addProject: vi.fn(),
  initProject: vi.fn(),
  removeProject: vi.fn(),

  // AI
  runAIReview: vi.fn().mockResolvedValue(undefined),

  // Terminal
  openTerminalPanel: vi.fn(),
  runScript: vi.fn(),

  // Context
  saveContext: vi.fn(),
  loadContext: vi.fn(),

  // Archive
  openArchivedModal: vi.fn(),
  restoreLastArchived: vi.fn(),

  // State getters
  hasActiveSession: vi.fn().mockReturnValue(true),
  hasActiveWorktree: vi.fn().mockReturnValue(true),
  hasSelectedProject: vi.fn().mockReturnValue(true),
  hasMultipleSessions: vi.fn().mockReturnValue(true),
  hasMultipleWorktrees: vi.fn().mockReturnValue(true),
  hasRunScript: vi.fn().mockReturnValue(true),
  getCurrentTheme: vi.fn().mockReturnValue('system'),
  getCurrentModel: vi.fn().mockReturnValue('opus'),
  getCurrentThinkingLevel: vi.fn().mockReturnValue('off'),
  getCurrentExecutionMode: vi.fn().mockReturnValue('plan'),
})

describe('Command System', () => {
  let mockContext: CommandContext

  beforeEach(() => {
    clearRegistry()
    mockContext = createMockContext()
    registerCommands(navigationCommands)
  })

  describe('Command Registration', () => {
    it('registers commands correctly', () => {
      const commands = getAllCommands(mockContext)
      expect(commands.length).toBeGreaterThan(0)

      const sidebarCommand = commands.find(
        cmd => cmd.id === 'show-left-sidebar' || cmd.id === 'hide-left-sidebar'
      )
      expect(sidebarCommand).toBeDefined()
      expect(sidebarCommand?.label).toContain('Left Sidebar')
    })

    it('filters commands by availability', () => {
      mockUIStore.getState.mockReturnValue({
        leftSidebarVisible: false,
        commandPaletteOpen: false,
        setLeftSidebarVisible: vi.fn(),
      })

      const availableCommands = getAllCommands(mockContext)
      const showSidebarCommand = availableCommands.find(
        cmd => cmd.id === 'show-left-sidebar'
      )
      const hideSidebarCommand = availableCommands.find(
        cmd => cmd.id === 'hide-left-sidebar'
      )

      expect(showSidebarCommand).toBeDefined()
      expect(hideSidebarCommand).toBeUndefined()
    })

    it('filters commands by search term', () => {
      const searchResults = getAllCommands(mockContext, 'sidebar')

      expect(searchResults.length).toBeGreaterThan(0)
      searchResults.forEach(cmd => {
        const matchesSearch =
          cmd.label.toLowerCase().includes('sidebar') ||
          cmd.description?.toLowerCase().includes('sidebar')

        expect(matchesSearch).toBe(true)
      })
    })
  })

  describe('Command Execution', () => {
    it('executes show-left-sidebar command correctly', async () => {
      mockUIStore.getState.mockReturnValue({
        leftSidebarVisible: false,
        commandPaletteOpen: false,
        setLeftSidebarVisible: vi.fn(),
      })

      const result = await executeCommand('show-left-sidebar', mockContext)

      expect(result.success).toBe(true)
    })

    it('fails to execute unavailable command', async () => {
      mockUIStore.getState.mockReturnValue({
        leftSidebarVisible: true,
        commandPaletteOpen: false,
        setLeftSidebarVisible: vi.fn(),
      })

      const result = await executeCommand('show-left-sidebar', mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('not available')
    })

    it('handles non-existent command', async () => {
      const result = await executeCommand('non-existent-command', mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('handles command execution errors', async () => {
      const errorCommand: AppCommand = {
        id: 'error-command',
        label: 'Error Command',
        execute: () => {
          throw new Error('Test error')
        },
      }

      registerCommands([errorCommand])

      const result = await executeCommand('error-command', mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Test error')
    })
  })
})

describe('Execution Commands', () => {
  let mockContext: CommandContext

  beforeEach(() => {
    clearRegistry()
    mockContext = createMockContext()
    registerCommands(executionCommands)
  })

  describe('execution mode commands', () => {
    it('registers all execution mode commands', () => {
      const commands = getAllCommands(mockContext)
      const executionIds = [
        'execution-plan',
        'execution-build',
        'execution-yolo',
        'cycle-execution-mode',
      ]
      const found = commands.filter(cmd => executionIds.includes(cmd.id))
      // cycle-execution-mode should always be available
      expect(found.some(c => c.id === 'cycle-execution-mode')).toBe(true)
    })

    it('execution-plan is unavailable when already in plan mode', () => {
      mockContext.getCurrentExecutionMode = vi.fn().mockReturnValue('plan')
      const commands = getAllCommands(mockContext)
      const planCmd = commands.find(c => c.id === 'execution-plan')
      expect(planCmd).toBeUndefined()
    })

    it('execution-build is available when not in build mode', async () => {
      mockContext.getCurrentExecutionMode = vi.fn().mockReturnValue('plan')
      const commands = getAllCommands(mockContext)
      const buildCmd = commands.find(c => c.id === 'execution-build')
      expect(buildCmd).toBeDefined()

      const result = await executeCommand('execution-build', mockContext)
      expect(result.success).toBe(true)
      expect(mockContext.setExecutionMode).toHaveBeenCalledWith('build')
    })

    it('execution-yolo command executes correctly', async () => {
      mockContext.getCurrentExecutionMode = vi.fn().mockReturnValue('plan')
      const result = await executeCommand('execution-yolo', mockContext)
      expect(result.success).toBe(true)
      expect(mockContext.setExecutionMode).toHaveBeenCalledWith('yolo')
    })

    it('cycle-execution-mode calls cycleExecutionMode', async () => {
      const result = await executeCommand('cycle-execution-mode', mockContext)
      expect(result.success).toBe(true)
      expect(mockContext.cycleExecutionMode).toHaveBeenCalled()
    })
  })
})

describe('Model Commands', () => {
  let mockContext: CommandContext

  beforeEach(() => {
    clearRegistry()
    mockContext = createMockContext()
    registerCommands(modelCommands)
  })

  describe('model selection commands', () => {
    it('set-model-opus is unavailable when already on opus', () => {
      mockContext.getCurrentModel = vi.fn().mockReturnValue('opus')
      const commands = getAllCommands(mockContext)
      const opusCmd = commands.find(c => c.id === 'set-model-opus')
      expect(opusCmd).toBeUndefined()
    })

    it('set-model-sonnet is available when on opus', async () => {
      mockContext.getCurrentModel = vi.fn().mockReturnValue('opus')
      const commands = getAllCommands(mockContext)
      const sonnetCmd = commands.find(c => c.id === 'set-model-sonnet')
      expect(sonnetCmd).toBeDefined()

      const result = await executeCommand('set-model-sonnet', mockContext)
      expect(result.success).toBe(true)
      expect(mockContext.setModel).toHaveBeenCalledWith('sonnet')
    })

    it('set-model-haiku executes correctly', async () => {
      mockContext.getCurrentModel = vi.fn().mockReturnValue('opus')
      const result = await executeCommand('set-model-haiku', mockContext)
      expect(result.success).toBe(true)
      expect(mockContext.setModel).toHaveBeenCalledWith('haiku')
    })
  })

  describe('thinking level commands', () => {
    it('thinking-off is unavailable when already off', () => {
      mockContext.getCurrentThinkingLevel = vi.fn().mockReturnValue('off')
      const commands = getAllCommands(mockContext)
      const offCmd = commands.find(c => c.id === 'thinking-off')
      expect(offCmd).toBeUndefined()
    })

    it('thinking-think executes correctly', async () => {
      mockContext.getCurrentThinkingLevel = vi.fn().mockReturnValue('off')
      const result = await executeCommand('thinking-think', mockContext)
      expect(result.success).toBe(true)
      expect(mockContext.setThinkingLevel).toHaveBeenCalledWith('think')
    })

    it('thinking-megathink executes correctly', async () => {
      mockContext.getCurrentThinkingLevel = vi.fn().mockReturnValue('off')
      const result = await executeCommand('thinking-megathink', mockContext)
      expect(result.success).toBe(true)
      expect(mockContext.setThinkingLevel).toHaveBeenCalledWith('megathink')
    })

    it('thinking-ultrathink executes correctly', async () => {
      mockContext.getCurrentThinkingLevel = vi.fn().mockReturnValue('off')
      const result = await executeCommand('thinking-ultrathink', mockContext)
      expect(result.success).toBe(true)
      expect(mockContext.setThinkingLevel).toHaveBeenCalledWith('ultrathink')
    })

    it('thinking commands require active session', () => {
      mockContext.hasActiveSession = vi.fn().mockReturnValue(false)
      mockContext.getCurrentThinkingLevel = vi.fn().mockReturnValue('off')
      const commands = getAllCommands(mockContext)
      const thinkingCmds = commands.filter(c => c.id.startsWith('thinking-'))
      expect(thinkingCmds.length).toBe(0)
    })
  })
})

describe('Git Commands', () => {
  let mockContext: CommandContext

  beforeEach(() => {
    clearRegistry()
    mockContext = createMockContext()
    registerCommands(gitCommands)
  })

  describe('git commands', () => {
    it('commit-changes command executes correctly', async () => {
      const result = await executeCommand('commit-changes', mockContext)
      expect(result.success).toBe(true)
      expect(mockContext.openCommitModal).toHaveBeenCalled()
    })

    it('view-git-diff command executes correctly', async () => {
      const result = await executeCommand('view-git-diff', mockContext)
      expect(result.success).toBe(true)
      expect(mockContext.viewGitDiff).toHaveBeenCalled()
    })

    it('open-pull-request command executes correctly', async () => {
      const result = await executeCommand('open-pull-request', mockContext)
      expect(result.success).toBe(true)
      expect(mockContext.openPullRequest).toHaveBeenCalled()
    })

    it('git commands require active worktree', () => {
      mockContext.hasActiveWorktree = vi.fn().mockReturnValue(false)
      const commands = getAllCommands(mockContext)
      const gitCmds = commands.filter(c => c.group === 'git')
      expect(gitCmds.length).toBe(0)
    })
  })
})

describe('Session Commands', () => {
  let mockContext: CommandContext

  beforeEach(() => {
    clearRegistry()
    mockContext = createMockContext()
    registerCommands(sessionCommands)
  })

  describe('session commands', () => {
    it('new-session command executes correctly', async () => {
      const result = await executeCommand('new-session', mockContext)
      expect(result.success).toBe(true)
      expect(mockContext.createSession).toHaveBeenCalled()
    })

    it('close-session command executes correctly', async () => {
      const result = await executeCommand('close-session', mockContext)
      expect(result.success).toBe(true)
      expect(mockContext.closeSession).toHaveBeenCalled()
    })

    it('next-session command executes correctly', async () => {
      const result = await executeCommand('next-session', mockContext)
      expect(result.success).toBe(true)
      expect(mockContext.nextSession).toHaveBeenCalled()
    })

    it('previous-session command executes correctly', async () => {
      const result = await executeCommand('previous-session', mockContext)
      expect(result.success).toBe(true)
      expect(mockContext.previousSession).toHaveBeenCalled()
    })

    it('navigation commands require active session', () => {
      mockContext.hasActiveSession = vi.fn().mockReturnValue(false)
      const commands = getAllCommands(mockContext)
      const nextCmd = commands.find(c => c.id === 'next-session')
      const prevCmd = commands.find(c => c.id === 'previous-session')
      expect(nextCmd).toBeUndefined()
      expect(prevCmd).toBeUndefined()
    })

    it('close-session requires active session', () => {
      mockContext.hasActiveSession = vi.fn().mockReturnValue(false)
      const commands = getAllCommands(mockContext)
      const closeCmd = commands.find(c => c.id === 'close-session')
      expect(closeCmd).toBeUndefined()
    })
  })
})

describe('All Commands Combined', () => {
  let mockContext: CommandContext

  beforeEach(() => {
    clearRegistry()
    mockContext = createMockContext()
    registerCommands(navigationCommands)
    registerCommands(executionCommands)
    registerCommands(modelCommands)
    registerCommands(gitCommands)
    registerCommands(sessionCommands)
  })

  it('registers all command groups', () => {
    const commands = getAllCommands(mockContext)
    const groups = new Set(commands.map(c => c.group).filter(Boolean))

    expect(groups.has('navigation')).toBe(true)
    expect(groups.has('execution')).toBe(true)
    expect(groups.has('model')).toBe(true)
    expect(groups.has('git')).toBe(true)
    expect(groups.has('sessions')).toBe(true)
  })

  it('commands have unique IDs', () => {
    const commands = getAllCommands(mockContext)
    const ids = commands.map(c => c.id)
    const uniqueIds = new Set(ids)
    // If sizes match, all IDs are unique
    expect(ids.length).toBe(uniqueIds.size)
  })

  it('search filters across all command groups', () => {
    const results = getAllCommands(mockContext, 'mode')
    expect(results.length).toBeGreaterThan(0)
    // Should find execution mode commands
    expect(results.some(c => c.id.includes('execution'))).toBe(true)
  })

  it('keyword search works', () => {
    // Search for 'fast' should find haiku (fastest) and yolo
    const results = getAllCommands(mockContext, 'fast')
    expect(results.length).toBeGreaterThan(0)
  })
})
