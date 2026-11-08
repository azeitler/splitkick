import { describe, expect, it } from 'vitest'
import {
  defaultTarget,
  fromDateTimeLocal,
  needsYoloConfirm,
  parseTime,
  presetToCron,
  quickPicks,
  toDateTimeLocal,
  toScheduleTemplate,
} from './schedule-compose'
import type { QueuedMessage } from '@/types/chat'

const queued: QueuedMessage = {
  id: 'q1',
  message: 'run the checks',
  pendingImages: [],
  pendingFiles: [],
  pendingSkills: [],
  pendingTextFiles: [],
  model: 'claude-fable-5',
  provider: null,
  executionMode: 'build',
  thinkingLevel: 'off',
  effortLevel: 'high',
  mcpConfig: '{"mcpServers":{}}',
  backend: 'claude',
  queuedAt: 123,
}

describe('schedule-compose', () => {
  it('sends later into this session and repeats into new sessions', () => {
    expect(defaultTarget('once')).toBe('session')
    expect(defaultTarget('repeat')).toBe('new_session')
  })

  it('keeps the toolbar settings and drops per-run fields', () => {
    const template = toScheduleTemplate(queued)
    expect(template).toMatchObject({
      model: 'claude-fable-5',
      backend: 'claude',
      executionMode: 'build',
      effortLevel: 'high',
      mcpConfig: '{"mcpServers":{}}',
    })
    expect(template).not.toHaveProperty('id')
    expect(template).not.toHaveProperty('queuedAt')
    expect(template).not.toHaveProperty('message')
  })

  it('asks for a confirm only in yolo mode', () => {
    expect(needsYoloConfirm({ ...queued, executionMode: 'yolo' })).toBe(true)
    expect(needsYoloConfirm(queued)).toBe(false)
    expect(needsYoloConfirm({ ...queued, executionMode: 'plan' })).toBe(false)
  })

  it('maps presets to cron patterns', () => {
    expect(presetToCron('hourly', '09:15')).toBe('15 * * * *')
    expect(presetToCron('daily', '09:00')).toBe('0 9 * * *')
    expect(presetToCron('weekdays', '08:30')).toBe('30 8 * * 1-5')
    expect(presetToCron('weekly', '17:05', 5)).toBe('5 17 * * 5')
    expect(presetToCron('daily', '25:00')).toBeNull()
    expect(parseTime('7:05')).toEqual([7, 5])
  })

  it('offers in 1 hour, tomorrow 09:00 and next Monday 09:00', () => {
    // Monday 2026-11-09 10:20 local
    const now = new Date(2026, 10, 9, 10, 20, 30)
    const [hour, tomorrow, monday] = quickPicks(now)
    expect(hour?.at.getHours()).toBe(11)
    expect(hour?.at.getSeconds()).toBe(0)
    expect(tomorrow?.at).toEqual(new Date(2026, 10, 10, 9, 0, 0))
    // On a Monday, "Monday" means next week.
    expect(monday?.at).toEqual(new Date(2026, 10, 16, 9, 0, 0))
  })

  it('round-trips datetime-local values', () => {
    const date = new Date(2026, 10, 8, 14, 5)
    const value = toDateTimeLocal(date)
    expect(value).toBe('2026-11-08T14:05')
    expect(fromDateTimeLocal(value)).toBe(Math.floor(date.getTime() / 1000))
    expect(fromDateTimeLocal('')).toBeNull()
  })
})
