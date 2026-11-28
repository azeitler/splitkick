/**
 * The start skeleton in index.html (#72). It paints before any script runs;
 * App.tsx shows it while the start gate is closed (preload, or no socket and
 * no preloaded data) and hides it once the app is up.
 */
export function setAppSkeletonVisible(visible: boolean): void {
  const skeleton = document.getElementById('app-skeleton')
  if (skeleton) skeleton.hidden = !visible
}

/** Start steps the app names after its code runs (see start loader). */
export const START_STEP_LABELS = {
  loadingProjects: 'Loading projects…',
  connecting: 'Connecting…',
} as const

/**
 * Name the current start step under the skeleton's progress bar. The start
 * loader (scripts/web-start-loader.mjs) has filled the bar for the download;
 * from here the steps are the app's own.
 */
export function setAppSkeletonStep(step: keyof typeof START_STEP_LABELS): void {
  const skeleton = document.getElementById('app-skeleton')
  if (!skeleton) return
  const label = skeleton.querySelector<HTMLElement>('.sk-step')
  if (label) {
    label.textContent = START_STEP_LABELS[step]
    label.hidden = false
  }
}
