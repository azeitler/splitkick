import React from 'react'
import {
  fireEvent,
  render,
  screen,
  type RenderOptions,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfirmDialogHost } from '@/components/ui/confirm-dialog'

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  })

interface AllTheProvidersProps {
  children: React.ReactNode
}

const AllTheProviders = ({ children }: AllTheProvidersProps) => {
  const queryClient = createTestQueryClient()

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* The app mounts it in MainWindow; confirmAction() needs it. */}
      <ConfirmDialogHost />
    </QueryClientProvider>
  )
}

const customRender = (
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => render(ui, { wrapper: AllTheProviders, ...options })

export * from '@testing-library/react'
export { customRender as render }

async function dialogButton(selector: string) {
  const dialog = await screen.findByRole('alertdialog')
  const button = dialog.querySelector<HTMLButtonElement>(selector)
  if (!button) throw new Error(`No ${selector} button in the dialog`)
  return button
}

/** Confirm the open destructive-action dialog (as Return would). */
export async function confirmDialog() {
  fireEvent.click(await dialogButton('[data-confirm-action]'))
}

/** Cancel the open destructive-action dialog. */
export async function cancelDialog() {
  fireEvent.click(await dialogButton('[data-confirm-cancel]'))
}
