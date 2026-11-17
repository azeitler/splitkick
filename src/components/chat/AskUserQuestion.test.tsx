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

    expect(
      screen.queryByPlaceholderText('Add a note or your own answer...')
    ).not.toBeInTheDocument()
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

    const input = screen.getByPlaceholderText(
      'Add a note or your own answer...'
    ) as HTMLInputElement
    expect(input.type).toBe('password')

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
    const [firstInput] = screen.getAllByPlaceholderText(
      'Add a note or your own answer...'
    )
    const toneRadio = screen.getAllByRole('radio')[3]
    if (!firstInput || !toneRadio) throw new Error('form not rendered')
    fireEvent.change(firstInput, { target: { value: 'Owls at night' } })
    fireEvent.click(toneRadio)
    view.unmount()

    render(
      <AskUserQuestion
        toolCallId="tool-draft"
        questions={questions}
        onSubmit={noopSubmit}
      />
    )
    expect(
      screen.getAllByPlaceholderText('Add a note or your own answer...')[0]
    ).toHaveValue('Owls at night')
    expect(screen.getAllByRole('radio')[3]).toBeChecked()
  })

  it('sends a picked option and a typed note together', () => {
    const onSubmit = vi.fn()
    render(
      <AskUserQuestion
        toolCallId="tool-both"
        questions={questions}
        onSubmit={onSubmit}
      />
    )
    const radio = screen.getAllByRole('radio')[1]
    const [input] = screen.getAllByPlaceholderText(
      'Add a note or your own answer...'
    )
    if (!radio || !input) throw new Error('form not rendered')
    // Either order keeps both: the option survives typing, the text a click.
    fireEvent.click(radio)
    fireEvent.change(input, { target: { value: 'only owls' } })
    fireEvent.click(screen.getAllByRole('radio')[0] as HTMLElement)
    expect(input).toHaveValue('only owls')
    fireEvent.click(screen.getByText('Answer'))
    expect(onSubmit).toHaveBeenCalledWith('tool-both', [
      { questionIndex: 0, selectedOptions: [0], customText: 'only owls' },
    ])
  })

  it('shows the option and the note in the answered summary', () => {
    render(
      <AskUserQuestion
        toolCallId="tool-both-done"
        questions={questions}
        onSubmit={noopSubmit}
        readOnly
        submittedAnswers={[
          { questionIndex: 0, selectedOptions: [1], customText: 'macro lens' },
        ]}
      />
    )
    expect(
      screen.getAllByText(/Bird photography \+ "macro lens"/).length
    ).toBeGreaterThan(0)
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
    const [input] = screen.getAllByPlaceholderText(
      'Add a note or your own answer...'
    )
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
    expect(
      screen.getAllByPlaceholderText('Add a note or your own answer...')[0]
    ).toHaveValue('')
  })
})
