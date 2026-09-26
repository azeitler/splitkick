type UIStateRelaunchSaver = () => Promise<void>

let saveBeforeRelaunch: UIStateRelaunchSaver | null = null

/**
 * Hand the UI-state writer to `relaunchAfterUIStateSave`.
 *
 * A relaunch tears the webview down without a close event, so the pending
 * debounced save would be lost. The saver lives in `useUIStatePersistence`,
 * which owns that timer; this registry lets `App` reach it without a prop.
 */
export function registerUIStateRelaunchSaver(
  saver: UIStateRelaunchSaver | null
): void {
  saveBeforeRelaunch = saver
}

export async function flushUIStateBeforeRelaunch(): Promise<void> {
  await saveBeforeRelaunch?.()
}

/** Persist the UI state, then relaunch — even when the write fails. */
export async function relaunchAfterUIStateSave(
  relaunch: () => Promise<void>
): Promise<void> {
  try {
    await flushUIStateBeforeRelaunch()
  } finally {
    await relaunch()
  }
}
