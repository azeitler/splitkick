import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { FullDiskAccessSection } from './FullDiskAccessSection'

const mocks = vi.hoisted(() => ({
  status: 'denied' as 'granted' | 'denied' | 'not_applicable',
  open: vi.fn().mockResolvedValue(undefined),
  relaunch: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/services/full-disk-access', () => ({
  getFullDiskAccessStatus: () => Promise.resolve(mocks.status),
  openFullDiskAccessSettings: mocks.open,
  relaunchForFullDiskAccess: mocks.relaunch,
}))

describe('FullDiskAccessSection', () => {
  beforeEach(() => {
    mocks.status = 'denied'
    mocks.open.mockClear()
    mocks.relaunch.mockClear()
  })

  it('explains the risk before the buttons', async () => {
    render(<FullDiskAccessSection />)

    expect(
      await screen.findByText('Full Disk Access (macOS)')
    ).toBeInTheDocument()
    expect(screen.getByText(/not recommended by default/)).toBeInTheDocument()
    expect(
      screen.getByText(/Mail, Messages, Safari history, Documents/)
    ).toBeInTheDocument()
    expect(screen.getByText(/prompt injection/)).toBeInTheDocument()
    expect(
      screen.getByText(/would like to access data from other apps/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/allow only the folders you need/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Privacy & Security → Full Disk Access/)
    ).toBeInTheDocument()

    const risk = screen.getByText(/prompt injection/)
    const button = screen.getByRole('button', { name: 'Open System Settings' })
    expect(
      risk.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('says "in this session" and offers an unconditional relaunch', async () => {
    const user = userEvent.setup()
    render(<FullDiskAccessSection />)

    expect(
      await screen.findByText(/Not granted in this session/)
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Open System Settings' })
    )
    expect(mocks.open).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Relaunch now' }))
    expect(mocks.relaunch).toHaveBeenCalledOnce()
  })

  it('shows the granted state without a relaunch button', async () => {
    mocks.status = 'granted'
    render(<FullDiskAccessSection />)

    expect(await screen.findByText('Granted.')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Open System Settings' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Relaunch now' })
    ).not.toBeInTheDocument()
  })

  it('renders nothing off macOS, in Web Access and in remote windows', async () => {
    mocks.status = 'not_applicable'
    const { container } = render(<FullDiskAccessSection />)
    await Promise.resolve()
    expect(container).toBeEmptyDOMElement()
  })
})
