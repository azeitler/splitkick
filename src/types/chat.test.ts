import { describe, expect, it } from 'vitest'
import {
  buildCodexUserInputAnswerMap,
  getAskUserQuestions,
  getTodoWriteTodos,
  hasQuestionAnswerOutput,
  isAskUserQuestion,
  isTodoWrite,
  normalizeCodexQuestions,
  normalizeTodoItem,
} from './chat'

describe('hasQuestionAnswerOutput', () => {
  it('returns false for Claude blocking-tool error output', () => {
    expect(hasQuestionAnswerOutput('Answer questions?')).toBe(false)
    expect(hasQuestionAnswerOutput('Error: Answer questions?')).toBe(false)
  })

  it('returns true for persisted JSON answers', () => {
    expect(
      hasQuestionAnswerOutput(
        JSON.stringify([{ questionIndex: 0, selectedOptions: [1] }])
      )
    ).toBe(true)
  })

  it('returns true for non-JSON backend answer output', () => {
    expect(hasQuestionAnswerOutput('Backyard birds')).toBe(true)
  })
})

describe('normalizeCodexQuestions', () => {
  it('normalizes Codex request_user_input questions for Jean question cards', () => {
    expect(
      normalizeCodexQuestions([
        {
          id: 'scope',
          header: 'Scope',
          question: 'Which scope should I use?',
          options: [
            { label: 'Backend', description: 'Rust only' },
            { label: 'Frontend' },
          ],
          isOther: true,
          isSecret: false,
        },
      ])
    ).toEqual([
      {
        header: 'Scope',
        question: 'Which scope should I use?',
        multiSelect: false,
        isOther: true,
        isSecret: false,
        options: [
          { label: 'Backend', description: 'Rust only' },
          { label: 'Frontend', description: undefined },
        ],
      },
    ])
  })
})

describe('isAskUserQuestion', () => {
  it('recognizes native Codex request_user_input tool calls', () => {
    expect(
      isAskUserQuestion({
        id: 'codex-user-input-1',
        name: 'request_user_input',
        input: {
          questions: [
            {
              id: 'scope',
              header: 'Scope',
              question: 'Which scope?',
              options: [{ label: 'Backend' }],
            },
          ],
        },
      })
    ).toBe(true)
  })
})

describe('TodoWrite (Grok + Claude)', () => {
  it('recognizes Grok todo_write with variant and missing activeForm', () => {
    const tool = {
      id: 'call-1',
      name: 'todo_write',
      input: {
        merge: false,
        variant: 'TodoWrite',
        todos: [
          {
            id: '1',
            content: 'Investigate steering',
            status: 'in_progress',
          },
          { id: '2', content: 'Fix tools', status: 'pending' },
        ],
      },
    }
    expect(isTodoWrite(tool)).toBe(true)
    expect(getTodoWriteTodos(tool)).toEqual([
      {
        content: 'Investigate steering',
        activeForm: 'Investigate steering',
        status: 'in_progress',
      },
      {
        content: 'Fix tools',
        activeForm: 'Fix tools',
        status: 'pending',
      },
    ])
  })

  it('recognizes ACP title "Updating plan" when input has todos', () => {
    const tool = {
      id: 'call-2',
      name: 'Updating plan',
      input: {
        todos: [{ content: 'A', status: 'completed' }],
        variant: 'TodoWrite',
      },
    }
    expect(isTodoWrite(tool)).toBe(true)
    expect(getTodoWriteTodos(tool)[0]?.status).toBe('completed')
  })

  it('normalizes alternate status strings on todo items', () => {
    expect(normalizeTodoItem({ content: 'x', status: 'done' })?.status).toBe(
      'completed'
    )
    expect(
      normalizeTodoItem({ content: 'y', status: 'in-progress' })?.status
    ).toBe('in_progress')
  })
})


  it('recognizes and parses Claude AskUserQuestion with questions encoded as JSON string', () => {
    const toolCall = {
      id: 'claude-question-1',
      name: 'AskUserQuestion',
      input: {
        questions:
          '[{"question":"Pick one","header":"Choice","multiSelect":false,"options":[{"label":"A"}]}]',
      },
    }

    expect(isAskUserQuestion(toolCall)).toBe(true)
    expect(getAskUserQuestions(toolCall.input)).toEqual([
      {
        question: 'Pick one',
        header: 'Choice',
        multiSelect: false,
        options: [{ label: 'A' }],
      },
    ])
  })

describe('buildCodexUserInputAnswerMap', () => {
  it('maps selected option labels and custom text by Codex question id', () => {
    expect(
      buildCodexUserInputAnswerMap(
        [
          {
            id: 'scope',
            header: 'Scope',
            question: 'Which scope?',
            options: [{ label: 'Backend' }, { label: 'Frontend' }],
          },
          {
            id: 'note',
            header: 'Note',
            question: 'Any note?',
            options: [],
            isOther: true,
          },
        ],
        [
          { questionIndex: 0, selectedOptions: [1] },
          { questionIndex: 1, selectedOptions: [], customText: 'ship it' },
        ]
      )
    ).toEqual({
      scope: { answers: ['Frontend'] },
      note: { answers: ['ship it'] },
    })
  })

  it('falls back to the question index when Codex omits an id', () => {
    expect(
      buildCodexUserInputAnswerMap(
        [
          {
            header: 'Scope',
            question: 'Which scope?',
            options: [{ label: 'Backend' }],
          },
        ],
        [{ questionIndex: 0, selectedOptions: [0] }]
      )
    ).toEqual({
      '0': { answers: ['Backend'] },
    })
  })
})
