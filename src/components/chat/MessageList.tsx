import { memo, useMemo } from 'react'
import type {
  ChatMessage,
  Question,
  QuestionAnswer,
  ReviewFinding,
} from '@/types/chat'
import { MessageItem } from './MessageItem'

interface MessageListProps {
  messages: ChatMessage[]
  totalMessages: number
  lastPlanMessageIndex: number
  sessionId: string
  worktreePath: string
  approveShortcut: string
  approveShortcutYolo?: string
  approveButtonRef?: React.RefObject<HTMLButtonElement | null>
  isSending: boolean
  onPlanApproval: (messageId: string) => void
  onPlanApprovalYolo?: (messageId: string) => void
  onQuestionAnswer: (
    toolCallId: string,
    answers: QuestionAnswer[],
    questions: Question[]
  ) => void
  onQuestionSkip: (toolCallId: string) => void
  onFileClick: (path: string) => void
  onEditedFileClick: (path: string) => void
  onFixFinding: (finding: ReviewFinding, suggestion?: string) => Promise<void>
  onFixAllFindings: (
    findings: { finding: ReviewFinding; suggestion?: string }[]
  ) => Promise<void>
  isQuestionAnswered: (sessionId: string, toolCallId: string) => boolean
  getSubmittedAnswers: (
    sessionId: string,
    toolCallId: string
  ) => QuestionAnswer[] | undefined
  areQuestionsSkipped: (sessionId: string) => boolean
  isFindingFixed: (sessionId: string, key: string) => boolean
  onCopyToInput?: (message: ChatMessage) => void
  hideApproveButtons?: boolean
}

/**
 * Simple message list that renders all messages.
 * Memoized to prevent re-renders when parent re-renders with same props.
 */
export const MessageList = memo(function MessageList({
  messages,
  totalMessages,
  lastPlanMessageIndex,
  sessionId,
  worktreePath,
  approveShortcut,
  approveShortcutYolo,
  approveButtonRef,
  isSending,
  onPlanApproval,
  onPlanApprovalYolo,
  onQuestionAnswer,
  onQuestionSkip,
  onFileClick,
  onEditedFileClick,
  onFixFinding,
  onFixAllFindings,
  isQuestionAnswered,
  getSubmittedAnswers,
  areQuestionsSkipped,
  isFindingFixed,
  onCopyToInput,
  hideApproveButtons,
}: MessageListProps) {
  // Pre-compute hasFollowUpMessage for all messages in O(n) instead of O(n²)
  const hasFollowUpMap = useMemo(() => {
    const map = new Map<number, boolean>()
    let foundUserMessage = false
    for (let i = messages.length - 1; i >= 0; i--) {
      map.set(i, foundUserMessage)
      if (messages[i]?.role === 'user') {
        foundUserMessage = true
      }
    }
    return map
  }, [messages])

  if (messages.length === 0) return null

  return (
    <div className="flex flex-col w-full">
      {messages.map((message, index) => {
        const hasFollowUpMessage =
          message.role === 'assistant' && (hasFollowUpMap.get(index) ?? false)

        return (
          <div key={message.id} className="pb-4">
            <MessageItem
              message={message}
              messageIndex={index}
              totalMessages={totalMessages}
              lastPlanMessageIndex={lastPlanMessageIndex}
              hasFollowUpMessage={hasFollowUpMessage}
              sessionId={sessionId}
              worktreePath={worktreePath}
              approveShortcut={approveShortcut}
              approveShortcutYolo={approveShortcutYolo}
              approveButtonRef={
                index === lastPlanMessageIndex ? approveButtonRef : undefined
              }
              isSending={isSending}
              onPlanApproval={onPlanApproval}
              onPlanApprovalYolo={onPlanApprovalYolo}
              onQuestionAnswer={onQuestionAnswer}
              onQuestionSkip={onQuestionSkip}
              onFileClick={onFileClick}
              onEditedFileClick={onEditedFileClick}
              onFixFinding={onFixFinding}
              onFixAllFindings={onFixAllFindings}
              isQuestionAnswered={isQuestionAnswered}
              getSubmittedAnswers={getSubmittedAnswers}
              areQuestionsSkipped={areQuestionsSkipped}
              isFindingFixed={isFindingFixed}
              onCopyToInput={onCopyToInput}
              hideApproveButtons={hideApproveButtons}
            />
          </div>
        )
      })}
    </div>
  )
})
