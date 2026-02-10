import React, { useState, useCallback, useEffect, useRef } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { usePreferences, useSavePreferences } from '@/services/preferences'
import {
  DEFAULT_INVESTIGATE_ISSUE_PROMPT,
  DEFAULT_INVESTIGATE_PR_PROMPT,
  DEFAULT_PR_CONTENT_PROMPT,
  DEFAULT_COMMIT_MESSAGE_PROMPT,
  DEFAULT_CODE_REVIEW_PROMPT,
  DEFAULT_CONTEXT_SUMMARY_PROMPT,
  DEFAULT_RESOLVE_CONFLICTS_PROMPT,
  DEFAULT_INVESTIGATE_WORKFLOW_RUN_PROMPT,
  DEFAULT_RELEASE_NOTES_PROMPT,
  DEFAULT_PARALLEL_EXECUTION_PROMPT,
  DEFAULT_MAGIC_PROMPTS,
  DEFAULT_MAGIC_PROMPT_MODELS,
  type MagicPrompts,
  type MagicPromptModels,
  type ClaudeModel,
} from '@/types/preferences'
import { cn } from '@/lib/utils'

interface VariableInfo {
  name: string
  description: string
}

interface PromptConfig {
  key: keyof MagicPrompts
  modelKey?: keyof MagicPromptModels
  label: string
  description: string
  variables: VariableInfo[]
  defaultValue: string
  defaultModel?: ClaudeModel
}

interface PromptSection {
  label: string
  configs: PromptConfig[]
}

const PROMPT_SECTIONS: PromptSection[] = [
  {
    label: 'Investigation',
    configs: [
      {
        key: 'investigate_issue',
        modelKey: 'investigate_model',
        label: 'Investigate Issue',
        description:
          'Prompt for analyzing GitHub issues loaded into the context.',
        variables: [
          {
            name: '{issueRefs}',
            description: 'Issue numbers (e.g., #123, #456)',
          },
          {
            name: '{issueWord}',
            description: '"issue" or "issues" based on count',
          },
        ],
        defaultValue: DEFAULT_INVESTIGATE_ISSUE_PROMPT,
        defaultModel: 'opus',
      },
      {
        key: 'investigate_pr',
        modelKey: 'investigate_model',
        label: 'Investigate PR',
        description:
          'Prompt for analyzing GitHub pull requests loaded into the context.',
        variables: [
          {
            name: '{prRefs}',
            description: 'PR numbers (e.g., #123, #456)',
          },
          {
            name: '{prWord}',
            description: '"pull request" or "pull requests" based on count',
          },
        ],
        defaultValue: DEFAULT_INVESTIGATE_PR_PROMPT,
        defaultModel: 'opus',
      },
      {
        key: 'investigate_workflow_run',
        modelKey: 'investigate_model',
        label: 'Investigate Workflow Run',
        description:
          'Prompt for investigating failed GitHub Actions workflow runs.',
        variables: [
          {
            name: '{workflowName}',
            description: 'Name of the workflow (e.g., CI, Deploy)',
          },
          {
            name: '{runUrl}',
            description: 'URL to the workflow run on GitHub',
          },
          { name: '{runId}', description: 'Numeric ID of the workflow run' },
          { name: '{branch}', description: 'Branch the workflow ran on' },
          {
            name: '{displayTitle}',
            description: 'Commit message or PR title that triggered the run',
          },
        ],
        defaultValue: DEFAULT_INVESTIGATE_WORKFLOW_RUN_PROMPT,
        defaultModel: 'opus',
      },
    ],
  },
  {
    label: 'Git Operations',
    configs: [
      {
        key: 'code_review',
        modelKey: 'code_review_model',
        label: 'Code Review',
        description: 'Prompt for AI-powered code review of your changes.',
        variables: [
          {
            name: '{branch_info}',
            description: 'Source and target branch names',
          },
          { name: '{commits}', description: 'Commit history' },
          { name: '{diff}', description: 'Code changes diff' },
          {
            name: '{uncommitted_section}',
            description: 'Unstaged changes if any',
          },
        ],
        defaultValue: DEFAULT_CODE_REVIEW_PROMPT,
        defaultModel: 'opus',
      },
      {
        key: 'commit_message',
        modelKey: 'commit_message_model',
        label: 'Commit Message',
        description:
          'Prompt for generating commit messages from staged changes.',
        variables: [
          { name: '{status}', description: 'Git status output' },
          { name: '{diff}', description: 'Staged changes diff' },
          {
            name: '{recent_commits}',
            description: 'Recent commit messages for style',
          },
          { name: '{remote_info}', description: 'Remote repository info' },
        ],
        defaultValue: DEFAULT_COMMIT_MESSAGE_PROMPT,
        defaultModel: 'haiku',
      },
      {
        key: 'pr_content',
        modelKey: 'pr_content_model',
        label: 'PR Description',
        description:
          'Prompt for generating pull request titles and descriptions.',
        variables: [
          {
            name: '{current_branch}',
            description: 'Name of the feature branch',
          },
          {
            name: '{target_branch}',
            description: 'Branch to merge into (e.g., main)',
          },
          {
            name: '{commit_count}',
            description: 'Number of commits in the PR',
          },
          { name: '{commits}', description: 'List of commit messages' },
          { name: '{diff}', description: 'Git diff of all changes' },
        ],
        defaultValue: DEFAULT_PR_CONTENT_PROMPT,
        defaultModel: 'haiku',
      },
      {
        key: 'resolve_conflicts',
        modelKey: 'resolve_conflicts_model',
        label: 'Resolve Conflicts',
        description: 'Instructions appended to conflict resolution prompts.',
        variables: [],
        defaultValue: DEFAULT_RESOLVE_CONFLICTS_PROMPT,
        defaultModel: 'opus',
      },
      {
        key: 'release_notes',
        modelKey: 'release_notes_model',
        label: 'Release Notes',
        description:
          'Prompt for generating release notes from changes since a prior release.',
        variables: [
          {
            name: '{tag}',
            description: 'Tag of the selected release',
          },
          {
            name: '{previous_release_name}',
            description: 'Name of the selected release',
          },
          {
            name: '{commits}',
            description: 'Commit messages since the selected release',
          },
        ],
        defaultValue: DEFAULT_RELEASE_NOTES_PROMPT,
        defaultModel: 'haiku',
      },
    ],
  },
  {
    label: 'Session',
    configs: [
      {
        key: 'context_summary',
        modelKey: 'context_summary_model',
        label: 'Context Summary',
        description:
          'Prompt for summarizing conversations when saving context.',
        variables: [
          {
            name: '{project_name}',
            description: 'Name of the current project',
          },
          { name: '{date}', description: 'Current timestamp' },
          {
            name: '{conversation}',
            description: 'Full conversation history',
          },
        ],
        defaultValue: DEFAULT_CONTEXT_SUMMARY_PROMPT,
        defaultModel: 'haiku',
      },
    ],
  },
  {
    label: 'System Prompts',
    configs: [
      {
        key: 'parallel_execution',
        label: 'Parallel Execution',
        description:
          'System prompt appended to every chat session when enabled in Experimental settings. Encourages sub-agent parallelization.',
        variables: [],
        defaultValue: DEFAULT_PARALLEL_EXECUTION_PROMPT,
      },
    ],
  },
]

// Flat list for lookups
const PROMPT_CONFIGS = PROMPT_SECTIONS.flatMap(s => s.configs)

const MODEL_OPTIONS: { value: ClaudeModel; label: string }[] = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
]

export const MagicPromptsPane: React.FC = () => {
  const { data: preferences } = usePreferences()
  const savePreferences = useSavePreferences()
  const [selectedKey, setSelectedKey] =
    useState<keyof MagicPrompts>('investigate_issue')
  const [localValue, setLocalValue] = useState('')
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const currentPrompts = preferences?.magic_prompts ?? DEFAULT_MAGIC_PROMPTS
  const currentModels =
    preferences?.magic_prompt_models ?? DEFAULT_MAGIC_PROMPT_MODELS
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const selectedConfig = PROMPT_CONFIGS.find(c => c.key === selectedKey)!
  const currentValue =
    currentPrompts[selectedKey] ?? selectedConfig.defaultValue
  const currentModel = selectedConfig.modelKey
    ? (currentModels[selectedConfig.modelKey] ?? selectedConfig.defaultModel)
    : undefined
  const isModified = currentPrompts[selectedKey] !== null

  // Sync local value when selection changes or external value updates
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalValue(currentValue)
  }, [currentValue, selectedKey])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  const handleChange = useCallback(
    (newValue: string) => {
      setLocalValue(newValue)

      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      // Set new timeout for debounced save
      saveTimeoutRef.current = setTimeout(() => {
        if (!preferences) return
        // Save null if matches default (auto-updates on new versions), otherwise save the value
        const valueToSave =
          newValue === selectedConfig.defaultValue ? null : newValue
        savePreferences.mutate({
          ...preferences,
          magic_prompts: {
            ...currentPrompts,
            [selectedKey]: valueToSave,
          },
        })
      }, 500)
    },
    [preferences, savePreferences, currentPrompts, selectedKey, selectedConfig.defaultValue]
  )

  const handleBlur = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }
    if (localValue !== currentValue && preferences) {
      const valueToSave =
        localValue === selectedConfig.defaultValue ? null : localValue
      savePreferences.mutate({
        ...preferences,
        magic_prompts: {
          ...currentPrompts,
          [selectedKey]: valueToSave,
        },
      })
    }
  }, [
    localValue,
    currentValue,
    preferences,
    savePreferences,
    currentPrompts,
    selectedKey,
    selectedConfig.defaultValue,
  ])

  const handleReset = useCallback(() => {
    if (!preferences) return
    savePreferences.mutate({
      ...preferences,
      magic_prompts: {
        ...currentPrompts,
        [selectedKey]: null,
      },
    })
  }, [preferences, savePreferences, currentPrompts, selectedKey])

  const handleModelChange = useCallback(
    (model: ClaudeModel) => {
      if (!preferences || !selectedConfig.modelKey) return
      savePreferences.mutate({
        ...preferences,
        magic_prompt_models: {
          ...currentModels,
          [selectedConfig.modelKey]: model,
        },
      })
    },
    [preferences, savePreferences, currentModels, selectedConfig.modelKey]
  )

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Prompt selector grid grouped by section */}
      <div className="mb-4 shrink-0 space-y-3">
        {PROMPT_SECTIONS.map(section => (
          <div key={section.label}>
            <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              {section.label}
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {section.configs.map(config => {
                const promptIsModified = currentPrompts[config.key] !== null
                const promptModel = config.modelKey
                  ? (currentModels[config.modelKey] ?? config.defaultModel)
                  : undefined
                return (
                  <button
                    key={config.key}
                    onClick={() => setSelectedKey(config.key)}
                    className={cn(
                      'px-3 py-2 rounded-lg border text-left transition-colors',
                      'hover:bg-muted/50',
                      selectedKey === config.key
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-card'
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-sm font-medium truncate">
                        {config.label}
                        {promptIsModified && (
                          <span className="text-muted-foreground ml-1">*</span>
                        )}
                      </span>
                      {promptModel && (
                        <span
                          className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0',
                            'bg-muted text-muted-foreground'
                          )}
                        >
                          {promptModel}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Selected prompt details */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Header */}
        <div className="mb-3 shrink-0">
          <h3 className="text-sm font-medium">{selectedConfig.label}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {selectedConfig.description}
          </p>
          <div className="flex items-center gap-2 mt-2">
            {currentModel && (
              <>
                <span className="text-xs text-muted-foreground">Used model</span>
                <Select
                  value={currentModel}
                  onValueChange={(v: string) => handleModelChange(v as ClaudeModel)}
                >
                  <SelectTrigger className="w-[110px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={!isModified}
              className="gap-1.5 h-8"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </Button>
          </div>
        </div>

        {/* Variables */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3 shrink-0">
          {selectedConfig.variables.map(v => (
            <div key={v.name} className="flex items-baseline gap-1 text-xs">
              <code className="bg-muted px-1 py-0.5 rounded font-mono text-[11px]">
                {v.name}
              </code>
              <span className="text-muted-foreground">{v.description}</span>
            </div>
          ))}
        </div>

        {/* Textarea - fills remaining space */}
        <Textarea
          value={localValue}
          onChange={e => handleChange(e.target.value)}
          onBlur={handleBlur}
          className="flex-1 min-h-0 h-full font-mono text-xs resize-none"
          placeholder={selectedConfig.defaultValue}
        />
      </div>
    </div>
  )
}
