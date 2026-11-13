import { PRODUCT_NAME } from '@/lib/build-info'
import { useState, useCallback, useEffect, useEffectEvent } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { ArrowLeft } from 'lucide-react'
import { useIsMobile } from '@/hooks/use-mobile'
import { isNativeApp } from '@/lib/environment'
import { useUIStore } from '@/store/ui-store'
import { usePreferences, usePatchPreferences } from '@/services/preferences'
import { formatShortcutDisplay, type ShortcutString } from '@/types/keybindings'
import { backendOptions } from '@/types/preferences'

interface TourItem {
  label: string
  detail?: string
  shortcut?: ShortcutString
}

interface TourStep {
  title: string
  description: string
  items: TourItem[]
}

const steps = [
  {
    title: 'Start with the Magic Menu',
    description: 'Automate everyday dev tasks without hunting through GitHub.',
    items: [
      {
        shortcut: 'mod+m' as ShortcutString,
        label: 'Open Magic Menu',
        detail: 'One place for the actions you repeat all day.',
      },
      {
        label: 'Commit, push, open PRs',
        detail: 'Ship the obvious git steps from the same menu.',
      },
      {
        label: 'Save context, load context, create recaps',
        detail: 'Capture the current state and bring it into the next session.',
      },
      {
        label: 'Resolve conflicts',
        detail: 'Hand messy merge conflicts to your selected AI backend.',
      },
      {
        label: 'Review, merge, and write release notes',
        detail:
          'Turn PR follow-up into a guided checklist instead of tab juggling.',
      },
      {
        label: 'Investigate issues, PRs, and security alerts',
        detail: 'Create focused worktrees with context already loaded.',
      },
    ] satisfies TourItem[],
  },
  {
    title: 'Automate the project routine',
    description: `${PRODUCT_NAME} can remember the setup, run, and cleanup work.`,
    items: [
      {
        shortcut: 'splitkick.json' as ShortcutString,
        label: 'Project automation file',
        detail:
          'Keep scripts in your repository so every worktree starts the same way.',
      },
      {
        shortcut: 'setup' as ShortcutString,
        label: 'Setup',
        detail:
          'Install dependencies or bootstrap services after a worktree is created.',
      },
      {
        shortcut: 'run' as ShortcutString,
        label: 'Run',
        detail: `Launch your dev server from ${PRODUCT_NAME} with the run shortcut.`,
      },
    ] satisfies TourItem[],
  },
  {
    title: 'Bring your favorite AI backend',
    description: `Use ${PRODUCT_NAME} with the AI agents and models that fit each task.`,
    items: backendOptions.map(backend => ({
      label: backend.label,
      detail:
        backend.value === 'antigravity'
          ? 'Beta backend available where installed and configured.'
          : 'Available for chat sessions, Magic prompts, and model picking when installed.',
    })) satisfies TourItem[],
  },
  {
    title: 'Mr. Robot',
    description: `Let ${PRODUCT_NAME} keep an eye on your issue queue.`,
    items: [
      {
        label: 'Issue sweeps',
        detail: `Poll open GitHub issues and create one ${PRODUCT_NAME} worktree per issue.`,
      },
      {
        label: 'Focused plans',
        detail:
          'Ask an AI backend to investigate and draft a targeted implementation plan.',
      },
      {
        label: 'Optional yolo',
        detail: 'When you trust the setup, Mr. Robot can execute the plan too.',
      },
      {
        label: 'Project Settings → Mr. Robot',
        detail:
          'Tune schedule, limits, active hours, and backend selection per project.',
      },
    ] satisfies TourItem[],
  },
  {
    title: 'Opinionated helpers',
    description: 'Install workflow skills across your AI backends.',
    items: [
      {
        label: 'Caveman',
        detail:
          'Short, accurate responses that save tokens across supported backends.',
      },
      {
        label: 'Superpowers',
        detail:
          'Brainstorming, TDD, debugging, plan writing, execution, and review workflows.',
      },
      {
        label: 'Preferences → Opinionated',
        detail:
          'Install or remove these packs when you want stronger defaults.',
      },
    ] satisfies TourItem[],
  },
  {
    title: 'Keyboard shortcuts',
    description: 'Memorize only the keys that unlock the fastest paths.',
    items: [
      {
        shortcut: 'mod+m' as ShortcutString,
        label: 'Magic Menu',
        detail: 'Automate everyday tasks.',
      },
      {
        shortcut: 'mod+n' as ShortcutString,
        label: 'New worktree',
        detail: 'Start isolated work on a branch.',
      },
      {
        shortcut: 'mod+t' as ShortcutString,
        label: 'New session',
        detail: 'Open the configured default session.',
      },
      {
        shortcut: 'mod+Enter' as ShortcutString,
        label: 'Approve plan',
        detail: 'Move from planning to execution.',
      },
      {
        shortcut: 'mod+k' as ShortcutString,
        label: 'Command palette',
        detail: 'Find any app command by name.',
      },
      {
        shortcut: 'mod+period' as ShortcutString,
        label: 'Quick menu',
        detail: 'Open contextual actions from the active surface.',
      },
      {
        shortcut: 'mod+l' as ShortcutString,
        label: 'Focus chat input',
        detail: 'Jump back to prompting without reaching for the mouse.',
      },
    ] satisfies TourItem[],
  },
] satisfies TourStep[]

function formatArrowKeys(shortcut: string): string {
  if (shortcut === 'ArrowLeft/ArrowRight') return '← →'
  if (shortcut === 'ArrowUp/ArrowDown') return '↑ ↓'
  return formatShortcutDisplay(shortcut as ShortcutString)
}

export function FeatureTourDialog() {
  return <FeatureTourDialogContent />
}

function FeatureTourDialogContent() {
  const featureTourOpen = useUIStore(state => state.featureTourOpen)
  const [stepIndex, setStepIndex] = useState(0)
  const { setFeatureTourOpen } = useUIStore.getState()
  const { data: preferences } = usePreferences()
  const patchPreferences = usePatchPreferences()
  const isMobile = useIsMobile()
  // Keyboard hints and keys only in the native desktop app (not web/mobile)
  const keyboardEnabled = isNativeApp() && !isMobile

  const markSeen = useCallback(() => {
    if (preferences && !preferences.has_seen_feature_tour) {
      patchPreferences.mutate({ has_seen_feature_tour: true })
    }
  }, [preferences, patchPreferences])

  const handleClose = useCallback(() => {
    setFeatureTourOpen(false)
    markSeen()
  }, [setFeatureTourOpen, markSeen])

  const handleNext = useCallback(() => {
    if (stepIndex < steps.length - 1) {
      setStepIndex(i => i + 1)
    } else {
      handleClose()
    }
  }, [stepIndex, handleClose])

  const handleBack = useCallback(() => {
    setStepIndex(i => Math.max(i - 1, 0))
  }, [])

  // Keyboard navigation: arrows, Enter, S
  const onTourKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      setStepIndex(i => Math.min(i + 1, steps.length - 1))
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      handleBack()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      handleNext()
    } else if (e.key === 's' || e.key === 'S') {
      e.preventDefault()
      handleClose()
    }
  })

  useEffect(() => {
    if (!featureTourOpen || !keyboardEnabled) return
    const handleKeyDown = (e: KeyboardEvent) => onTourKeyDown(e)
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [featureTourOpen, keyboardEnabled])

  const step = steps[stepIndex] as (typeof steps)[number]
  const isLastStep = stepIndex === steps.length - 1

  return (
    <Dialog
      open={featureTourOpen}
      onOpenChange={open => !open && handleClose()}
    >
      {/* Fits any window: header and footer stay, the item list scrolls */}
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
        showCloseButton
      >
        <DialogHeader className="shrink-0 px-6 pt-6 pb-3">
          {/* Step dots */}
          <div className="flex items-center justify-center gap-1.5 mb-2">
            {steps.map((s, i) => (
              <button
                key={s.title}
                type="button"
                aria-label={`Go to ${s.title}`}
                aria-current={i === stepIndex ? 'step' : undefined}
                onClick={() => setStepIndex(i)}
                className={`size-2 rounded-full transition-colors cursor-pointer hover:bg-primary/70 ${
                  i === stepIndex
                    ? 'bg-primary'
                    : i < stepIndex
                      ? 'bg-primary/40'
                      : 'bg-muted-foreground/30'
                }`}
              />
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground sm:text-left">
            Step {stepIndex + 1} of {steps.length}
          </p>
          <DialogTitle className="text-lg">{step.title}</DialogTitle>
          <DialogDescription>{step.description}</DialogDescription>
        </DialogHeader>

        <div
          data-testid="feature-tour-body"
          className="min-h-0 flex-1 space-y-2 overflow-y-auto px-6 py-3 [@media(min-height:720px)]:min-h-[300px] [&_img]:h-auto [&_img]:max-w-full"
        >
          {step.items.map(item => (
            <div
              key={`${item.shortcut ?? item.label}-${item.label}`}
              className="flex items-start gap-3 rounded-md border border-border/50 bg-muted/30 px-3 py-2.5"
            >
              {item.shortcut && (
                <Kbd className="mt-0.5 h-6 min-w-8 shrink-0 px-2 text-xs font-medium">
                  {formatArrowKeys(item.shortcut)}
                </Kbd>
              )}
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground/90">
                  {item.label}
                </div>
                {item.detail && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {item.detail}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t px-6 py-3">
          <Button variant="ghost" size="sm" onClick={handleClose}>
            Skip
            {keyboardEnabled && (
              <Kbd className="ml-1 h-4 px-1 text-[10px]">S</Kbd>
            )}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleBack}
              disabled={stepIndex === 0}
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <Button size="sm" className="min-w-18" onClick={handleNext}>
              {isLastStep ? 'Done' : 'Next'}
              {keyboardEnabled && (
                <Kbd className="ml-1 h-4 px-1 text-[10px]">↵</Kbd>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
