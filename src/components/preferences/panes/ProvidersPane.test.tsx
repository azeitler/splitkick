import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelDialog,
  confirmDialog,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@/test/test-utils'
import { defaultPreferences, type AppPreferences } from '@/types/preferences'
import { ProvidersPane } from './ProvidersPane'

const invokeMock = vi.fn()
const mutateMock = vi.fn()

vi.mock('@/lib/transport', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

const preferences: AppPreferences = {
  ...defaultPreferences,
  custom_cli_profiles: [
    { name: 'Acme Proxy', settings_json: '{"env":{}}' },
    { name: 'Acme Backup', settings_json: '{"env":{}}' },
  ],
  custom_codex_providers: [
    {
      name: 'Acme Router',
      provider_id: 'acme',
      base_url: 'https://acme.example/v1',
      env_key: 'ACME_API_KEY',
    },
  ],
  custom_pi_providers: [
    {
      name: 'acme-pi',
      base_url: 'https://pi.acme.example/v1',
      api: 'openai-completions',
      models: [{ id: 'acme-model' }],
    },
  ],
}

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: preferences }),
  usePatchPreferences: () => ({ mutate: mutateMock }),
}))

/** Click the trash button in the row that shows `name`. */
function clickDelete(name: string) {
  const row = screen.getByText(name).closest('.rounded-md')
  expect(row).toBeTruthy()
  const buttons = (row as HTMLElement).querySelectorAll('button')
  fireEvent.click(buttons[buttons.length - 1] as HTMLButtonElement)
}

async function expectDialogClosed() {
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
}

describe('ProvidersPane delete confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invokeMock.mockResolvedValue(null)
  })

  it('keeps a Claude CLI profile when the dialog is cancelled', async () => {
    render(<ProvidersPane />)
    clickDelete('Acme Proxy')
    expect(
      await screen.findByText('Delete provider “Acme Proxy”?')
    ).toBeInTheDocument()

    await cancelDialog()
    await expectDialogClosed()

    expect(invokeMock).not.toHaveBeenCalledWith(
      'delete_cli_profile',
      expect.anything()
    )
    expect(mutateMock).not.toHaveBeenCalled()
  })

  it('deletes a Claude CLI profile after confirming', async () => {
    render(<ProvidersPane />)
    clickDelete('Acme Proxy')
    await screen.findByText('Delete provider “Acme Proxy”?')

    await confirmDialog()

    await waitFor(() =>
      expect(mutateMock).toHaveBeenCalledWith({
        custom_cli_profiles: [
          { name: 'Acme Backup', settings_json: '{"env":{}}' },
        ],
      })
    )
    expect(invokeMock).toHaveBeenCalledWith('delete_cli_profile', {
      name: 'Acme Proxy',
    })
  })

  it('keeps a Codex provider when the dialog is cancelled', async () => {
    render(<ProvidersPane />)
    clickDelete('Acme Router')
    expect(
      await screen.findByText('Delete provider “Acme Router”?')
    ).toBeInTheDocument()

    await cancelDialog()
    await expectDialogClosed()

    expect(mutateMock).not.toHaveBeenCalled()
  })

  it('deletes a Codex provider after confirming', async () => {
    render(<ProvidersPane />)
    clickDelete('Acme Router')
    await screen.findByText('Delete provider “Acme Router”?')

    await confirmDialog()

    await waitFor(() =>
      expect(mutateMock).toHaveBeenCalledWith({ custom_codex_providers: [] })
    )
  })

  it('keeps a PI provider when the dialog is cancelled', async () => {
    render(<ProvidersPane />)
    clickDelete('acme-pi')
    expect(
      await screen.findByText('Delete provider “acme-pi”?')
    ).toBeInTheDocument()

    await cancelDialog()
    await expectDialogClosed()

    expect(invokeMock).not.toHaveBeenCalledWith(
      'delete_pi_provider',
      expect.anything()
    )
    expect(mutateMock).not.toHaveBeenCalled()
  })

  it('deletes a PI provider after confirming', async () => {
    render(<ProvidersPane />)
    clickDelete('acme-pi')
    await screen.findByText('Delete provider “acme-pi”?')

    await confirmDialog()

    await waitFor(() =>
      expect(mutateMock).toHaveBeenCalledWith({ custom_pi_providers: [] })
    )
    expect(invokeMock).toHaveBeenCalledWith('delete_pi_provider', {
      name: 'acme-pi',
    })
  })
})
