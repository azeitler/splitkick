import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@/test/test-utils'
import { AskUserQuestion } from './AskUserQuestion'
import type { QuestionAnswer, Question } from '@/types/chat'

describe('AskUserQuestion', () => {
  const questions: Question[] = [
    {
      header: 'Topic',
      question: 'What angle or topic within birds interests you most?',
      multiSelect: false,
      options: [
        {
          label: 'Backyard birding',
          description: 'Personal experiences watching birds at home',
        },
        {
          label: 'Bird photography',
          description: 'Tips around photographing birds',
        },
      ],
    },
    {
      header: 'Tone',
      question: 'What tone should the post have?',
      multiSelect: false,
      options: [
        {
          label: 'Reflective',
          description: 'Deeper thoughts on nature and slowing down',
        },
        {
          label: 'Fun & educational',
          description: 'Light-hearted facts and observations',
        },
      ],
    },
  ]

  const noopSubmit = (_toolCallId: string, _answers: QuestionAnswer[]) => {
    // noop for test
  }

  // azeitler/jean#32: the options never arrived, and the block rendered only
  // the intro sentence with nothing to answer.
  it('says so when a question arrives without options', () => {
    const onSubmit = vi.fn()
    render(
      <AskUserQuestion
        toolCallId="tool-empty"
        questions={[]}
        onSubmit={onSubmit}
        introText="Before I commit, I need two decisions in this worktree."
      />
    )

    expect(
      screen.getByText(
        'Before I commit, I need two decisions in this worktree.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(/its options did not arrive\. Answer in the message box/)
    ).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  // #139: the dialog MCP server died. The error is not an answer, and nothing
  // was reloaded.
  const connectionClosed =
    'Error calling tool (AskUserQuestion): Connection closed'

  it('shows the error of a failed call and keeps the form answerable', () => {
    render(
      <AskUserQuestion
        toolCallId="tool-failed"
        questions={questions}
        onSubmit={noopSubmit}
        toolOutput={connectionClosed}
      />
    )

    expect(
      screen.getByText(
        `The question failed: ${connectionClosed}. Your answer goes to the agent as a new message.`
      )
    ).toBeInTheDocument()
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(0)
    expect(screen.queryByText(/after reload/)).not.toBeInTheDocument()
  })

  it('shows the error, not a reload, for a failed call answered later', () => {
    render(
      <AskUserQuestion
        toolCallId="tool-failed-answered"
        questions={questions}
        onSubmit={noopSubmit}
        readOnly
        hasFollowUpMessage
        toolOutput={connectionClosed}
      />
    )

    fireEvent.click(screen.getByText('Answered (details unavailable)'))

    expect(
      screen.getAllByText(`The question failed: ${connectionClosed}`)
    ).toHaveLength(questions.length)
    expect(screen.queryByText(/after reload/)).not.toBeInTheDocument()
  })

  it('keeps the answered summary for an answered question even without options', () => {
    render(
      <AskUserQuestion
        toolCallId="tool-empty-answered"
        questions={[]}
        onSubmit={noopSubmit}
        readOnly
      />
    )

    expect(
      screen.queryByText(/its options did not arrive/)
    ).not.toBeInTheDocument()
  })

  it('shows a skipped question as Skipped, also when a message follows', () => {
    // A new message sent instead of an answer stores an empty answer list
    // (supersedePendingQuestions); the follow-up message must not turn it
    // into "Answered".
    render(
      <AskUserQuestion
        toolCallId="tool-superseded"
        questions={questions}
        onSubmit={noopSubmit}
        readOnly
        hasFollowUpMessage
        submittedAnswers={[]}
      />
    )

    expect(
      screen.queryByText('Answered (details unavailable)')
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Skipped'))
    expect(screen.getAllByText('Skipped.')).toHaveLength(questions.length)
  })

  it('shows persisted answer labels in the collapsed summary and expanded content', () => {
    render(
      <AskUserQuestion
        toolCallId="tool-1"
        questions={questions}
        onSubmit={noopSubmit}
        readOnly
        submittedAnswers={[
          { questionIndex: 0, selectedOptions: [0] },
          { questionIndex: 1, selectedOptions: [0] },
        ]}
      />
    )

    expect(
      screen.getByText('Backyard birding | Reflective')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByText('Backyard birding | Reflective'))

    expect(
      screen.getByText('Personal experiences watching birds at home')
    ).toBeVisible()
    expect(
      screen.getByText('Deeper thoughts on nature and slowing down')
    ).toBeVisible()
    expect(
      screen.queryByText('Answered (details unavailable)')
    ).not.toBeInTheDocument()
  })

  it('reconstructs answers from persisted tool output when submitted answers are missing', () => {
    render(
      <AskUserQuestion
        toolCallId="tool-1"
        questions={questions}
        onSubmit={noopSubmit}
        readOnly
        hasFollowUpMessage
        toolOutput={JSON.stringify([
          { questionIndex: 0, selectedOptions: [1] },
          { questionIndex: 1, selectedOptions: [1] },
        ])}
      />
    )

    expect(
      screen.getByText('Bird photography | Fun & educational')
    ).toBeInTheDocument()
  })

  it('hides custom text input when the question does not allow other answers', () => {
    render(
      <AskUserQuestion
        toolCallId="tool-1"
        questions={[
          {
            header: 'Choice',
            question: 'Pick one',
            multiSelect: false,
            isOther: false,
            options: [{ label: 'A' }, { label: 'B' }],
          },
        ]}
        onSubmit={noopSubmit}
      />
    )

    expect(screen.queryByLabelText('Other answer')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Note')).not.toBeInTheDocument()
  })

  it('submits secret custom answers when other answers are allowed', () => {
    const onSubmit = vi.fn()

    render(
      <AskUserQuestion
        toolCallId="tool-1"
        questions={[
          {
            header: 'Token',
            question: 'Paste token',
            multiSelect: false,
            isOther: true,
            isSecret: true,
            options: [],
          },
        ]}
        onSubmit={onSubmit}
      />
    )

    const input = screen.getByLabelText('Other answer') as HTMLInputElement
    expect(input.type).toBe('password')
    // No plain-text note next to a secret.
    expect(screen.queryByLabelText('Note')).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'shhh' } })
    fireEvent.click(screen.getByText('Answer'))

    expect(onSubmit).toHaveBeenCalledWith('tool-1', [
      { questionIndex: 0, selectedOptions: [], customText: 'shhh' },
    ])
  })

  // Switching sessions unmounts the form; the draft must come back.
  it('keeps typed text and picked options across a remount', () => {
    const view = render(
      <AskUserQuestion
        toolCallId="tool-draft"
        questions={questions}
        onSubmit={noopSubmit}
      />
    )
    const [firstOther] = screen.getAllByLabelText('Other answer')
    const [, secondNote] = screen.getAllByLabelText('Note')
    // Question 2's second option (question 1 has 2 options + Other).
    const toneRadio = screen.getAllByRole('radio')[4]
    if (!firstOther || !secondNote || !toneRadio)
      throw new Error('form not rendered')
    fireEvent.change(firstOther, { target: { value: 'Owls at night' } })
    fireEvent.change(secondNote, { target: { value: 'short please' } })
    fireEvent.click(toneRadio)
    view.unmount()

    render(
      <AskUserQuestion
        toolCallId="tool-draft"
        questions={questions}
        onSubmit={noopSubmit}
      />
    )
    expect(screen.getAllByLabelText('Other answer')[0]).toHaveValue(
      'Owls at night'
    )
    expect(screen.getAllByLabelText('Note')[1]).toHaveValue('short please')
    expect(screen.getAllByRole('radio')[4]).toBeChecked()
  })

  it('sends a picked option and a note together', () => {
    const onSubmit = vi.fn()
    render(
      <AskUserQuestion
        toolCallId="tool-both"
        questions={questions}
        onSubmit={onSubmit}
      />
    )
    const radio = screen.getAllByRole('radio')[1]
    const [note] = screen.getAllByLabelText('Note')
    if (!radio || !note) throw new Error('form not rendered')
    fireEvent.click(radio)
    fireEvent.change(note, { target: { value: 'only owls' } })
    fireEvent.click(screen.getByText('Answer'))
    expect(onSubmit).toHaveBeenCalledWith('tool-both', [
      { questionIndex: 0, selectedOptions: [1], note: 'only owls' },
    ])
  })

  it('gives an own answer through Other when no option fits', () => {
    const onSubmit = vi.fn()
    render(
      <AskUserQuestion
        toolCallId="tool-other"
        questions={questions}
        onSubmit={onSubmit}
      />
    )
    // Pick an option first, then change your mind: typing in Other replaces it.
    fireEvent.click(screen.getAllByRole('radio')[0] as HTMLElement)
    const [other] = screen.getAllByLabelText('Other answer')
    if (!other) throw new Error('form not rendered')
    fireEvent.change(other, { target: { value: 'Owls at night' } })
    expect(screen.getAllByRole('radio')[0]).not.toBeChecked()
    expect(screen.getAllByRole('radio', { name: 'Other' })[0]).toBeChecked()
    fireEvent.click(screen.getByText('Answer'))
    expect(onSubmit).toHaveBeenCalledWith('tool-other', [
      { questionIndex: 0, selectedOptions: [], customText: 'Owls at night' },
    ])
  })

  it('drops the Other text when an option is picked after it', () => {
    const onSubmit = vi.fn()
    render(
      <AskUserQuestion
        toolCallId="tool-other-then-option"
        questions={questions}
        onSubmit={onSubmit}
      />
    )
    const [other] = screen.getAllByLabelText('Other answer')
    if (!other) throw new Error('form not rendered')
    fireEvent.change(other, { target: { value: 'Owls' } })
    fireEvent.click(screen.getAllByRole('radio')[1] as HTMLElement)
    fireEvent.click(screen.getByText('Answer'))
    expect(onSubmit).toHaveBeenCalledWith('tool-other-then-option', [
      { questionIndex: 0, selectedOptions: [1] },
    ])
  })

  it('shows the option, the own answer and the note when answered', () => {
    render(
      <AskUserQuestion
        toolCallId="tool-both-done"
        questions={questions}
        onSubmit={noopSubmit}
        readOnly
        submittedAnswers={[
          { questionIndex: 0, selectedOptions: [1], note: 'macro lens' },
          {
            questionIndex: 1,
            selectedOptions: [],
            customText: 'dry humour',
          },
        ]}
      />
    )
    expect(
      screen.getAllByText(/Bird photography \(note: macro lens\)/).length
    ).toBeGreaterThan(0)
    expect(screen.getAllByText(/"dry humour"/).length).toBeGreaterThan(0)
  })

  it('drops the draft once the answer is sent', () => {
    const onSubmit = vi.fn()
    const view = render(
      <AskUserQuestion
        toolCallId="tool-draft-sent"
        questions={questions}
        onSubmit={onSubmit}
      />
    )
    const [input] = screen.getAllByLabelText('Other answer')
    if (!input) throw new Error('form not rendered')
    fireEvent.change(input, { target: { value: 'Owls' } })
    fireEvent.click(screen.getByText('Answer'))
    expect(onSubmit).toHaveBeenCalledWith('tool-draft-sent', [
      { questionIndex: 0, selectedOptions: [], customText: 'Owls' },
    ])
    view.unmount()

    render(
      <AskUserQuestion
        toolCallId="tool-draft-sent"
        questions={questions}
        onSubmit={noopSubmit}
      />
    )
    expect(screen.getAllByLabelText('Other answer')[0]).toHaveValue('')
  })
})
