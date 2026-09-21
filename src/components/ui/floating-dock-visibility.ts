/**
 * Whether the corner dock stays hidden.
 *
 * On a phone's tab root the corner belongs to the tab bar's search button, and
 * everything the dock offered there has a home already: Add project and
 * Archived on the Home tab, the rest in the command palette. Inside a project
 * or a session the dock keeps its place.
 */
export function shouldHideFloatingDock(
  isMobile: boolean,
  zenMode: boolean,
  /** Nothing is selected: the phone layout is showing its tabs. */
  atTabRoot = false
) {
  return zenMode || (isMobile && atTabRoot)
}
