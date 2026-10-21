import { invoke } from '@/lib/transport'

/**
 * Relaunch the native app. Rust owns the relaunch: Tauri's own one starts a
 * second instance on macOS, which shows a second Dock tile.
 */
export async function relaunchApp(): Promise<void> {
  await invoke('relaunch_app')
}
