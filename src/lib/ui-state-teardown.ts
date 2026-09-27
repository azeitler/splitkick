type UIStateSaver = () => Promise<void>

let saveBeforeTeardown: UIStateSaver | null = null

/**
 * Hand the UI-state writer to whatever tears the webview down.
 *
 * A relaunch and a quit both destroy the webview without a page unload, so the
 * pending debounced save would be lost — `beforeunload` and `pagehide` never
 * fire. The saver lives in `useUIStatePersistence`, which owns that timer;
 * this registry lets the teardown paths reach it without a prop.
 */
export function registerUIStateSaver(saver: UIStateSaver | null): void {
  saveBeforeTeardown = saver
}

/** Write the pending UI state and wait for it. Safe before hydration. */
export async function flushUIStateBeforeTeardown(): Promise<void> {
  await saveBeforeTeardown?.()
}

/** Persist the UI state, then relaunch — even when the write fails. */
export async function relaunchAfterUIStateSave(
  relaunch: () => Promise<void>
): Promise<void> {
  try {
    await flushUIStateBeforeTeardown()
  } finally {
    await relaunch()
  }
}
