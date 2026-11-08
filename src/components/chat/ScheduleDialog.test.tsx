import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import { ScheduleDialog, presetFromRecurrence } from './ScheduleDialog'

function renderDialog(props: Partial<Parameters<typeof ScheduleDialog>[0]>) {
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  render(
    <ScheduleDialog
      open
      onOpenChange={vi.fn()}
      kind="once"
      initial={{ prompt: 'check the build' }}
      onSubmit={onSubmit}
      {...props}
    />
  )
  return onSubmit
}

describe('ScheduleDialog', () => {
  it('schedules a one-off into this session by default', async () => {
    const onSubmit = renderDialog({})
    await userEvent.click(screen.getByRole('button', { name: 'Schedule' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'check the build',
        target: 'session',
        recurrence: undefined,
      })
    )
    expect(onSubmit.mock.calls[0]?.[0].fireAtUnix).toBeGreaterThan(
      Date.now() / 1000
    )
  })

  it('repeats daily into a new session by default', async () => {
    const onSubmit = renderDialog({ kind: 'repeat' })
    await userEvent.click(screen.getByRole('button', { name: 'Schedule' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        target: 'new_session',
        fireAtUnix: undefined,
        recurrence: expect.objectContaining({ cron: '0 9 * * *' }),
      })
    )
  })

  // Plan Q3: nothing is saved in yolo mode before the explicit confirm.
  it('asks before an unattended yolo run', async () => {
    const onSubmit = renderDialog({ yolo: true })
    await userEvent.click(screen.getByRole('button', { name: 'Schedule' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(
      await screen.findByText('Run unattended in Yolo mode?')
    ).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: 'Schedule in Yolo mode' })
    )
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('reads stored rules back into presets', () => {
    const tz = 'UTC'
    expect(presetFromRecurrence({ cron: '30 8 * * 1-5', tz })).toMatchObject({
      preset: 'weekdays',
      time: '08:30',
    })
    expect(presetFromRecurrence({ cron: '0 9 * * 1', tz })).toMatchObject({
      preset: 'weekly',
      weekday: 1,
    })
    expect(presetFromRecurrence({ cron: '15 * * * *', tz }).preset).toBe(
      'hourly'
    )
    expect(presetFromRecurrence({ cron: '0 9 1 * *', tz }).preset).toBe(
      'custom'
    )
  })
})
