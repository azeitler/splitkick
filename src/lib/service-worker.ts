/**
 * Web Access service worker (#72): registration, the update on "Reload",
 * persistent storage and a cache reset. The worker itself is generated at
 * build time by `scripts/web-service-worker.mjs` into `dist/sw.js`.
 */
import { isNativeApp } from '@/lib/environment'
import { logger } from '@/lib/logger'
import { reloadApp } from '@/lib/web-reload-log'

const SHELL_CACHE_PREFIX = 'splitkick-shell-'
const UPDATE_WAIT_MS = 10_000

/**
 * Only in Web Access, in a build, on HTTPS or localhost (a secure context).
 * The desktop app never registers one: its window is not Web Access.
 */
export function canUseServiceWorker(): boolean {
  return (
    !isNativeApp() &&
    !import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator
  )
}

export async function registerServiceWorker(): Promise<void> {
  if (!canUseServiceWorker()) return
  try {
    // `updateViaCache: 'none'`: the browser always fetches sw.js fresh.
    await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    })
  } catch (error) {
    logger.warn('Service worker registration failed', { error })
  }
}

/**
 * Asks the browser to keep this origin's storage (token, view, app cache).
 * iOS grants it by heuristics, mostly for Home Screen apps.
 */
export async function requestPersistentStorage(): Promise<boolean | null> {
  if (isNativeApp() || !navigator.storage?.persist) return null
  try {
    if (await navigator.storage.persisted()) return true
    const granted = await navigator.storage.persist()
    logger.info('Persistent storage requested', { granted })
    return granted
  } catch {
    return null
  }
}

function waitForState(
  worker: ServiceWorker,
  states: ServiceWorkerState[]
): Promise<void> {
  if (states.includes(worker.state)) return Promise.resolve()
  return new Promise(resolve => {
    const timer = setTimeout(resolve, UPDATE_WAIT_MS)
    worker.addEventListener('statechange', () => {
      if (states.includes(worker.state)) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
}

function waitForControllerChange(): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, UPDATE_WAIT_MS)
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}

/**
 * The "Reload" of the "Splitkick was updated" toast: fetch the new worker,
 * let it take over, then reload. Without a worker this is a plain reload.
 * Each wait has a timeout, so a stuck worker can never block the reload.
 */
export async function updateServiceWorkerAndReload(): Promise<void> {
  try {
    if (!canUseServiceWorker()) return
    const registration = await navigator.serviceWorker.getRegistration('/')
    if (!registration) return
    await registration.update()
    const worker = registration.installing ?? registration.waiting
    if (!worker) return
    await waitForState(worker, ['installed', 'activated', 'redundant'])
    if (registration.waiting && navigator.serviceWorker.controller) {
      const controllerChanged = waitForControllerChange()
      registration.waiting.postMessage({ type: 'skip-waiting' })
      await controllerChanged
    }
  } catch (error) {
    logger.warn('Service worker update failed', { error })
  } finally {
    reloadApp('new-version')
  }
}

/** Removes the worker and its caches, then reloads from the network. */
export async function resetAppCache(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map(r => r.unregister()))
    }
    if ('caches' in window) {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter(name => name.startsWith(SHELL_CACHE_PREFIX))
          .map(name => caches.delete(name))
      )
    }
  } finally {
    reloadApp('reset-app-cache')
  }
}

/** Whether a worker controls this page (for Settings → Web Access). */
export function isServiceWorkerActive(): boolean {
  return (
    'serviceWorker' in navigator && navigator.serviceWorker.controller !== null
  )
}
