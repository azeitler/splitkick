/**
 * The start skeleton in index.html (#72). It paints before any script runs;
 * App.tsx shows it while the start gate is closed (preload, or no socket and
 * no preloaded data) and hides it once the app is up.
 */
export function setAppSkeletonVisible(visible: boolean): void {
  const skeleton = document.getElementById('app-skeleton')
  if (skeleton) skeleton.hidden = !visible
}
