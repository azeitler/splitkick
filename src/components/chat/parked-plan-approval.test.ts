import { describe, expect, it } from 'vitest'
import {
  planApprovalMessage,
  resolveApprovalRunSettings,
} from './parked-plan-approval'

const current = {
  model: 'claude-opus-4-8',
  thinkingLevel: 'think' as const,
  effortLevel: 'high' as const,
}
const noOverrides = {
  backend: null,
  model: null,
  thinkingLevel: null,
  effortLevel: null,
}

describe('resolveApprovalRunSettings (#136)', () => {
  it('approves in-turn when the overrides keep the run settings', () => {
    expect(
      resolveApprovalRunSettings('claude', current, noOverrides, true)
    ).toEqual({ ...current, needsNewTurn: false })
    expect(
      resolveApprovalRunSettings(
        'claude',
        current,
        { ...noOverrides, model: 'claude-opus-4-8' },
        true
      ).needsNewTurn
    ).toBe(false)
  })

  it('needs a new turn when an override changes the model or effort', () => {
    const model = resolveApprovalRunSettings(
      'claude',
      current,
      { ...noOverrides, model: 'claude-sonnet-4-6' },
      true
    )
    expect(model).toMatchObject({
      model: 'claude-sonnet-4-6',
      needsNewTurn: true,
    })
    expect(
      resolveApprovalRunSettings(
        'claude',
        current,
        { ...noOverrides, effortLevel: 'max' },
        true
      ).needsNewTurn
    ).toBe(true)
  })

  it('ignores overrides for another backend', () => {
    expect(
      resolveApprovalRunSettings(
        'claude',
        current,
        {
          backend: 'codex',
          model: 'gpt-5.5',
          thinkingLevel: null,
          effortLevel: 'max',
        },
        true
      )
    ).toEqual({ ...current, needsNewTurn: false })
  })

  it('drops effort without adaptive thinking', () => {
    expect(
      resolveApprovalRunSettings(
        'claude',
        { ...current, effortLevel: undefined },
        { ...noOverrides, effortLevel: 'max' },
        false
      ).needsNewTurn
    ).toBe(false)
  })

  it('words the new-turn approval per mode', () => {
    expect(planApprovalMessage('build')).toMatch(/^Plan approved\. /)
    expect(planApprovalMessage('yolo')).toMatch(/yolo mode/)
  })
})
