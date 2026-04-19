import { memo } from 'react'
import { Brain, ClipboardList, Hammer, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  MODEL_OPTIONS,
  THINKING_LEVEL_OPTIONS,
  EFFORT_LEVEL_OPTIONS,
} from '@/components/chat/toolbar/toolbar-options'
import { formatOpencodeModelLabel } from '@/components/chat/toolbar/toolbar-utils'
import type { EffortLevel, ExecutionMode, ThinkingLevel } from '@/types/chat'

interface MessageSettingsBadgesProps {
  model: string | undefined
  executionMode: ExecutionMode | undefined
  thinkingLevel: ThinkingLevel | undefined
  effortLevel: EffortLevel | undefined
  isCursor: boolean
}

export const MessageSettingsBadges = memo(function MessageSettingsBadges({
  model,
  executionMode,
  thinkingLevel,
  effortLevel,
  isCursor,
}: MessageSettingsBadgesProps) {
  if (!model) return null

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="inline-flex items-center gap-1 rounded bg-muted/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
        {MODEL_OPTIONS.find(o => o.value === model)?.label ??
          (model.includes('/') ? formatOpencodeModelLabel(model) : model)}
      </span>
      {executionMode && (
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]',
            executionMode === 'plan' &&
              'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400',
            executionMode === 'build' && 'bg-muted/80 text-muted-foreground',
            executionMode === 'yolo' &&
              'bg-red-500/20 text-red-600 dark:text-red-400'
          )}
        >
          {executionMode === 'plan' && (
            <ClipboardList className="h-2.5 w-2.5" />
          )}
          {executionMode === 'build' && <Hammer className="h-2.5 w-2.5" />}
          {executionMode === 'yolo' && <Zap className="h-2.5 w-2.5" />}
          <span className="capitalize">{executionMode}</span>
        </span>
      )}
      {!isCursor &&
        (effortLevel ? (
          <span className="inline-flex items-center gap-1 rounded bg-muted/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            <Brain className="h-2.5 w-2.5" />
            {EFFORT_LEVEL_OPTIONS.find(o => o.value === effortLevel)?.label ??
              effortLevel}
          </span>
        ) : thinkingLevel && thinkingLevel !== 'off' ? (
          <span className="inline-flex items-center gap-1 rounded bg-muted/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            <Brain className="h-2.5 w-2.5" />
            {THINKING_LEVEL_OPTIONS.find(o => o.value === thinkingLevel)
              ?.label ?? thinkingLevel}
          </span>
        ) : null)}
    </div>
  )
})
