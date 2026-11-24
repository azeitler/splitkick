import { describe, expect, it } from 'vitest'
import {
  buildTimeline,
  coalesceContentBlocks,
  getIntroTextBeforeDuplicatePlan,
  isDuplicatePlanTextBlock,
  resolvePlanContent,
  splitTextAroundPlan,
} from './tool-call-utils'
import type { ContentBlock, ToolCall } from '@/types/chat'

describe('splitTextAroundPlan', () => {
  it('separates prose before a trailing plan block', () => {
    expect(
      splitTextAroundPlan(
        'Repo inspected.\n\nPlan:\n- Implement changes\n- Add tests'
      )
    ).toEqual({
      beforePlan: 'Repo inspected.',
      plan: 'Plan:\n- Implement changes\n- Add tests',
    })
  })

  it('returns the full text as non-plan content when no plan heading exists', () => {
    expect(splitTextAroundPlan('Repo inspected.')).toEqual({
      beforePlan: 'Repo inspected.',
      plan: null,
    })
  })
})

describe('resolvePlanContent', () => {
  it('extracts only the plan section from assistant text when tool only has explanation', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'plan-1',
        name: 'CodexPlan',
        input: {
          explanation: 'Repo inspected. Native plan had no prose body.',
          steps: [{ step: 'Clarify scope', status: 'in_progress' }],
        },
      },
    ]

    expect(
      resolvePlanContent({
        toolCalls,
        messageContent:
          'Repo inspected.\n\nPlan:\n- Implement changes\n- Add tests',
      })
    ).toEqual({
      content: 'Plan:\n- Implement changes\n- Add tests',
      source: 'message_text',
    })
  })

  it('keeps tool-provided plan content ahead of assistant text', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'plan-1',
        name: 'CodexPlan',
        input: {
          plan: 'Plan:\n- Tool plan wins',
          explanation: 'Fallback explanation',
        },
      },
    ]

    expect(
      resolvePlanContent({
        toolCalls,
        messageContent: 'Plan:\n- Message text loses',
      })
    ).toEqual({
      content: 'Plan:\n- Tool plan wins',
      source: 'plan',
    })
  })

  it('ignores non-string tool plan payloads and falls back to assistant text', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'plan-1',
        name: 'CodexPlan',
        input: {
          plan: [{ step: 'Wrong runtime shape' }],
          explanation: 'Summary only',
          steps: [{ step: 'Clarify scope', status: 'in_progress' }],
        },
      },
    ]

    expect(
      resolvePlanContent({
        toolCalls,
        messageContent:
          'Repo inspected.\n\nPlan:\n- Remove auto-continue\n- Add tests',
      })
    ).toEqual({
      content: 'Plan:\n- Remove auto-continue\n- Add tests',
      source: 'message_text',
    })
  })

  it('extracts a plan section from fragmented text blocks before explanation fallback', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'plan-1',
        name: 'CodexPlan',
        input: {
          explanation: 'Summary only',
          steps: [{ step: 'Clarify scope', status: 'in_progress' }],
        },
      },
    ]

    expect(
      resolvePlanContent({
        toolCalls,
        contentBlocks: [
          { type: 'text', text: 'Repo inspected.\n\n' },
          { type: 'text', text: 'Plan:\n- Remove auto-continue' },
          { type: 'text', text: '\n- Add tests' },
        ],
      })
    ).toEqual({
      content: 'Plan:\n- Remove auto-continue\n- Add tests',
      source: 'message_text',
    })
  })

  it('formats structured Codex steps when no plan text was persisted', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'plan-1',
        name: 'CodexPlan',
        input: {
          explanation: 'Extend the existing backup pipeline.',
          steps: [
            { step: 'Generalize the schema', status: 'completed' },
            { step: 'Update the backup UI', status: 'in_progress' },
            { step: 'Run regression tests', status: 'pending' },
          ],
        },
      },
    ]

    expect(resolvePlanContent({ toolCalls })).toEqual({
      content:
        'Extend the existing backup pipeline.\n\n- [x] Generalize the schema\n- [ ] **In progress:** Update the backup UI\n- [ ] Run regression tests',
      source: 'steps',
    })
  })

  it('prefers the richest body when multiple CodexPlan tools exist', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'codex-plan-turn-1',
        name: 'CodexPlan',
        input: {
          explanation: 'Plan created and ready for approval.',
          steps: [{ step: 'Touch files', status: 'pending' }],
        },
      },
      {
        id: 'codex-plan-plan-1',
        name: 'CodexPlan',
        input: {
          plan: 'Plan:\n- Rewrite the parser in codex.rs\n- Add merge tests for split plan tools\n- Verify YOLO handoff content',
        },
      },
    ]

    expect(resolvePlanContent({ toolCalls })).toEqual({
      content:
        'Plan:\n- Rewrite the parser in codex.rs\n- Add merge tests for split plan tools\n- Verify YOLO handoff content',
      source: 'plan',
    })
  })

  it('does not treat status-only explanation as authoritative plan content when assistant text is richer', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'plan-1',
        name: 'CodexPlan',
        input: {
          explanation: 'Plan created and ready for approval.',
          steps: [{ step: 'Do the thing', status: 'pending' }],
        },
      },
    ]

    const detailed =
      'Goal: rewrite plan extraction.\n\n1. Unify CodexPlan tool ids across live and history paths.\n2. Prefer richest plan body when tools split.\n3. Require handoff-quality plan prompts for Codex.\n4. Cover with unit tests for multi-tool resolution.'

    expect(
      resolvePlanContent({
        toolCalls,
        messageContent: detailed,
      })
    ).toEqual({
      content: detailed,
      source: 'message_text',
    })
  })

  it('does not promote ordinary YOLO narration into a Plan card without a plan tool', () => {
    const narration =
      "I'll find the mobile search/type filter layout and make the search full-width with the type selector stacked below it. Using Tailwind to stack the search and category filter on mobile. Checking existing tests, then applying the layout change."

    expect(
      resolvePlanContent({
        toolCalls: [
          {
            id: 'bash-1',
            name: 'Bash',
            input: { command: 'rg mobile search' },
          },
          {
            id: 'grep-1',
            name: 'Grep',
            input: { pattern: 'input-sticky' },
          },
        ],
        messageContent: narration,
        contentBlocks: [
          { type: 'tool_use', tool_call_id: 'bash-1' },
          { type: 'text', text: narration },
          { type: 'tool_use', tool_call_id: 'grep-1' },
        ],
      })
    ).toEqual({ content: null, source: null })
  })

  it('returns null for empty tool lists even when assistant text looks plan-like', () => {
    expect(
      resolvePlanContent({
        toolCalls: [],
        messageContent:
          'Plan:\n- Do the thing\n- Add tests\n- Verify handoff quality for YOLO',
      })
    ).toEqual({ content: null, source: null })
  })
})

describe('isDuplicatePlanTextBlock', () => {
  it('matches blocks whose extracted plan equals resolved plan content', () => {
    expect(
      isDuplicatePlanTextBlock(
        'Repo inspected.\n\nPlan:\n- Implement changes',
        'Plan:\n- Implement changes'
      )
    ).toBe(true)
  })

  it('does not hide different assistant text just because it contains a plan heading', () => {
    expect(
      isDuplicatePlanTextBlock(
        'Repo inspected.\n\nPlan:\n- Implement changes\n- Add tests',
        'Plan:\n- Implement changes'
      )
    ).toBe(false)
  })

  it('matches Cursor CLI plan text that has no "Plan:" prefix (direct equality)', () => {
    const planText =
      '1. Do you want me to switch out of plan mode and implement now?\n\n- a) Yes, proceed\n- b) No, stay in plan mode'
    expect(isDuplicatePlanTextBlock(planText, planText)).toBe(true)
  })

  it('does not suppress unrelated text even when a plan exists', () => {
    expect(
      isDuplicatePlanTextBlock(
        'Here is some intro text.',
        '1. Do you want me to switch out of plan mode?'
      )
    ).toBe(false)
  })
})

describe('getIntroTextBeforeDuplicatePlan', () => {
  it('returns null when the whole assistant text is the rendered plan', () => {
    expect(
      getIntroTextBeforeDuplicatePlan(
        'Short answer: goal is separate from plan mode.',
        'Short answer: goal is separate from plan mode.'
      )
    ).toBeNull()
  })

  it('returns prose before a matching trailing plan section', () => {
    expect(
      getIntroTextBeforeDuplicatePlan(
        'Repo inspected.\n\nPlan:\n- Implement changes',
        'Plan:\n- Implement changes'
      )
    ).toBe('Repo inspected.')
  })
})

describe('coalesceContentBlocks', () => {
  it('merges consecutive text blocks into one', () => {
    const input: ContentBlock[] = [
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'world' },
    ]
    expect(coalesceContentBlocks(input)).toEqual([
      { type: 'text', text: 'Hello world' },
    ])
  })

  it('preserves tool_use and thinking boundaries', () => {
    const input: ContentBlock[] = [
      { type: 'text', text: 'a' },
      { type: 'tool_use', tool_call_id: 't1' },
      { type: 'text', text: 'b1' },
      { type: 'text', text: 'b2' },
      { type: 'thinking', thinking: 'pondering' },
      { type: 'text', text: 'c' },
    ]
    expect(coalesceContentBlocks(input)).toEqual([
      { type: 'text', text: 'a' },
      { type: 'tool_use', tool_call_id: 't1' },
      { type: 'text', text: 'b1b2' },
      { type: 'thinking', thinking: 'pondering' },
      { type: 'text', text: 'c' },
    ])
  })

  it('is idempotent', () => {
    const input: ContentBlock[] = [
      { type: 'text', text: 'one' },
      { type: 'text', text: 'two' },
      { type: 'tool_use', tool_call_id: 't1' },
      { type: 'text', text: 'three' },
      { type: 'text', text: 'four' },
    ]
    const once = coalesceContentBlocks(input)
    const twice = coalesceContentBlocks(once)
    expect(twice).toEqual(once)
  })

  it('preserves paragraph separators embedded in deltas', () => {
    const input: ContentBlock[] = [
      { type: 'text', text: 'para1' },
      { type: 'text', text: '\n\npara2' },
    ]
    expect(coalesceContentBlocks(input)).toEqual([
      { type: 'text', text: 'para1\n\npara2' },
    ])
  })
})

describe('buildTimeline with fragmented text deltas', () => {
  it('renders native Codex request_user_input in the inline question timeline slot', () => {
    const tools: ToolCall[] = [
      {
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
      },
    ]
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'Need one decision first.' },
      { type: 'tool_use', tool_call_id: 'codex-user-input-1' },
      { type: 'text', text: 'request_user_input UI unavailable here' },
    ]

    const timeline = buildTimeline(blocks, tools)

    expect(timeline).toHaveLength(1)
    expect(timeline[0]).toMatchObject({
      type: 'askUserQuestion',
      introText: 'Need one decision first.',
      tool: expect.objectContaining({ id: 'codex-user-input-1' }),
    })
  })

  // A turn with a sub-agent, main-thread steps, a note, a question answered
  // in the turn, more steps and the reply: every block stays in turn order.
  describe('a turn with a sub-agent and an in-turn question', () => {
    const question = {
      id: 'q-1',
      name: 'AskUserQuestion',
      input: {
        questions: [
          {
            header: 'Next',
            question: 'Which sample?',
            multiSelect: false,
            options: [{ label: 'A' }, { label: 'B' }],
          },
        ],
      },
      output: 'The user answered: A',
    }
    const tools: ToolCall[] = [
      {
        id: 'agent-1',
        name: 'Agent',
        input: { prompt: 'Read a page' },
        output: 'done',
      },
      {
        id: 'sub-1',
        name: 'WebFetch',
        input: {},
        output: 'page',
        parent_tool_use_id: 'agent-1',
      },
      { id: 'main-1', name: 'ToolSearch', input: {}, output: 'ok' },
      {
        id: 'main-2',
        name: 'mcp__playwright__browser_navigate',
        input: {},
        output: 'ok',
      },
      {
        id: 'main-3',
        name: 'mcp__playwright__browser_evaluate',
        input: {},
        output: 'ok',
      },
      {
        id: 'main-4',
        name: 'mcp__playwright__browser_evaluate',
        input: {},
        output: 'ok',
      },
      question,
      { id: 'main-5', name: 'WebSearch', input: {}, output: 'ok' },
      { id: 'main-6', name: 'Bash', input: { command: 'ls' }, output: 'ok' },
    ]
    const blocks: ContentBlock[] = [
      { type: 'tool_use', tool_call_id: 'agent-1' },
      { type: 'tool_use', tool_call_id: 'sub-1' },
      { type: 'tool_use', tool_call_id: 'main-1' },
      { type: 'tool_use', tool_call_id: 'main-2' },
      { type: 'tool_use', tool_call_id: 'main-3' },
      { type: 'text', text: 'Reading the sample reviews now.' },
      { type: 'tool_use', tool_call_id: 'main-4' },
      { type: 'tool_use', tool_call_id: 'q-1' },
      { type: 'tool_use', tool_call_id: 'main-5' },
      { type: 'tool_use', tool_call_id: 'main-6' },
      { type: 'text', text: 'Here is the sample summary.' },
    ]

    it('keeps main-thread steps out of the finished sub-agent', () => {
      const timeline = buildTimeline(blocks, tools)
      const task = timeline.find(item => item.type === 'task')
      expect(task?.type === 'task' && task.subTools.map(t => t.id)).toEqual([
        'sub-1',
      ])
      expect(timeline.map(item => item.type)).toEqual([
        'task',
        'stackedGroup',
        'text',
        'standalone',
        'askUserQuestion',
        'stackedGroup',
        'text',
      ])
    })

    it('keeps a note that a step separates from the question in place', () => {
      const timeline = buildTimeline(blocks, tools)
      const ask = timeline.find(item => item.type === 'askUserQuestion')
      expect(ask?.type === 'askUserQuestion' && ask.introText).toBeFalsy()
      expect(timeline[2]).toMatchObject({
        type: 'text',
        text: 'Reading the sample reviews now.',
      })
    })

    it('still groups old messages without parent ids by turn order', () => {
      const legacy = tools.map(({ parent_tool_use_id: _, ...tool }) => tool)
      const timeline = buildTimeline(
        [
          { type: 'tool_use', tool_call_id: 'agent-1' },
          { type: 'tool_use', tool_call_id: 'sub-1' },
          { type: 'text', text: 'Done.' },
        ],
        legacy
      )
      const task = timeline.find(item => item.type === 'task')
      expect(task?.type === 'task' && task.subTools.map(t => t.id)).toEqual([
        'sub-1',
      ])
    })
  })

  it('keeps the final text after a question answered in the same turn (#154)', () => {
    const tools: ToolCall[] = [
      { id: 'cmd-1', name: 'Bash', input: { command: 'ls' }, output: 'ok' },
      {
        id: 'question-1',
        name: 'AskUserQuestion',
        input: {
          questions: [
            {
              header: 'Next',
              question: 'What next?',
              multiSelect: false,
              options: [{ label: 'Ship' }, { label: 'Wait' }],
            },
          ],
        },
        output: 'The user answered: Ship',
      },
      { id: 'cmd-2', name: 'Bash', input: { command: 'pwd' }, output: 'ok' },
    ]
    const blocks: ContentBlock[] = [
      { type: 'tool_use', tool_call_id: 'cmd-1' },
      { type: 'tool_use', tool_call_id: 'question-1' },
      { type: 'tool_use', tool_call_id: 'cmd-2' },
      { type: 'text', text: 'All shipped. Here is the summary.' },
    ]

    const timeline = buildTimeline(blocks, tools)

    expect(timeline.map(i => i.type)).toEqual([
      'standalone',
      'askUserQuestion',
      'standalone',
      'text',
    ])
    expect(timeline[3]).toMatchObject({
      text: 'All shipped. Here is the summary.',
    })
  })

  // A Claude turn ends at its question. What came before it keeps its
  // order: text, step, note, then the question as the last item.
  it('keeps the order of a turn that ends at its question', () => {
    const tools: ToolCall[] = [
      { id: 'step-1', name: 'Bash', input: { command: 'ls' }, output: 'ok' },
      {
        id: 'question-1',
        name: 'AskUserQuestion',
        input: {
          questions: [
            {
              header: 'Next',
              question: 'What next?',
              multiSelect: false,
              options: [{ label: 'Ship' }],
            },
          ],
        },
      },
    ]
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'I check the sample first.' },
      { type: 'tool_use', tool_call_id: 'step-1' },
      { type: 'text', text: 'One decision is open.' },
      { type: 'tool_use', tool_call_id: 'question-1' },
    ]

    const timeline = buildTimeline(blocks, tools)

    expect(timeline.map(i => i.type)).toEqual([
      'text',
      'standalone',
      'askUserQuestion',
    ])
    expect(timeline[0]).toMatchObject({ text: 'I check the sample first.' })
    // The note right before the question is its intro text, not lost.
    expect(timeline[2]).toMatchObject({ introText: 'One decision is open.' })
  })

  it('still hides the text that follows an unanswered question', () => {
    const tools: ToolCall[] = [
      {
        id: 'question-1',
        name: 'AskUserQuestion',
        input: {
          questions: [
            {
              header: 'Next',
              question: 'What next?',
              multiSelect: false,
              options: [{ label: 'Ship' }],
            },
          ],
        },
      },
    ]
    const blocks: ContentBlock[] = [
      { type: 'tool_use', tool_call_id: 'question-1' },
      { type: 'text', text: 'What next? Ship or wait?' },
    ]

    const timeline = buildTimeline(blocks, tools)

    expect(timeline.map(i => i.type)).toEqual(['askUserQuestion'])
  })

  it('renders Claude AskUserQuestion when questions are encoded as JSON string', () => {
    const tools: ToolCall[] = [
      {
        id: 'claude-question-1',
        name: 'AskUserQuestion',
        input: {
          questions:
            '[{"question":"Pick one","header":"Choice","multiSelect":false,"options":[{"label":"A"}]}]',
        },
      },
    ]
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'Need one decision.' },
      { type: 'tool_use', tool_call_id: 'claude-question-1' },
    ]

    const timeline = buildTimeline(blocks, tools)

    expect(timeline).toHaveLength(1)
    expect(timeline[0]).toMatchObject({
      type: 'askUserQuestion',
      introText: 'Need one decision.',
      tool: {
        input: {
          questions: [
            {
              question: 'Pick one',
              header: 'Choice',
              multiSelect: false,
              options: [{ label: 'A' }],
            },
          ],
        },
      },
    })
  })

  it('renders fragmented text as one paragraph item', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'para1' },
      { type: 'text', text: '\n\npara2' },
    ]
    const timeline = buildTimeline(blocks, [])
    expect(timeline).toHaveLength(1)
    expect(timeline[0]).toMatchObject({
      type: 'text',
      text: 'para1\n\npara2',
    })
  })

  it('tool grouping matches streaming when text deltas surround tools', () => {
    const tools: ToolCall[] = [
      { id: 'A', name: 'Read', input: {}, output: 'ok' },
      { id: 'B', name: 'Grep', input: {}, output: 'ok' },
      { id: 'C', name: 'Glob', input: {}, output: 'ok' },
    ]
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'intro-' },
      { type: 'text', text: 'start' },
      { type: 'tool_use', tool_call_id: 'A' },
      { type: 'tool_use', tool_call_id: 'B' },
      { type: 'text', text: 'mid-' },
      { type: 'text', text: 'summary' },
      { type: 'tool_use', tool_call_id: 'C' },
    ]
    const timeline = buildTimeline(blocks, tools)
    expect(timeline.map(i => i.type)).toEqual([
      'text',
      'stackedGroup',
      'text',
      'standalone',
    ])
    expect(timeline[0]).toMatchObject({ text: 'intro-start' })
    expect(timeline[2]).toMatchObject({ text: 'mid-summary' })
  })
})
