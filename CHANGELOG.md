# Changelog

All notable changes to Jean are recorded in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Title bar: a Usage button that shows plan limits in place.** Plan limits for
  Claude, Codex and Grok were only visible in Settings → Usage, which covers the
  whole app for a glance at a percentage. A chart button now sits in the left
  title bar, after Settings, and opens the same pane in a popover under it.
  - The popover shows every installed and signed-in backend, with the same
    progress bars, plan names, reset times and Refresh button as the Settings
    pane.
  - A "Settings" button in its header opens Settings on the Usage pane, for the
    times you want the full-height view.
  - The usage figures load only while the popover is open, and they are shared
    with the dock's usage badge, so opening it asks the backends for nothing
    they were not already asked.
  - The dock usage dropdown is unchanged. It follows the active session, while
    the title bar button is always in reach.

- **Files sidebar: a context menu on file and folder rows.** A row could only
  be left-clicked into Jean's internal viewer. A right-click now gives Open,
  Open in your editor, Open in Default App, Reveal in Finder, Open in Terminal
  (folders only), Add to Chat, Copy Path and Copy Relative Path.
  - "Reveal in Finder" selects the target inside its parent folder. Windows
    shows it in Explorer. Linux opens the parent folder, because it has no
    portable flag to select a file.
  - "Open in Default App" hands the file to the application the operating
    system has registered for it, so images and PDFs no longer open in a code
    editor.
  - "Add to Chat" puts the row into the composer as an `@mention` and attaches
    the file, the same as the `@` popover does.
  - Items that need a host shell are hidden in web access. Open, Add to Chat
    and the two copy items stay available.

### Fixed

- **Sidebar: "Completed" and "Cancelled" session statuses now change the row.**
  Setting a session to Completed had no visible effect, and Cancelled did not
  move the row out of the Review section. Three causes were corrected:
  - Completed shared the green indicator with "Review ready". It now has its own
    light-blue dot, in the sidebar as well as in the unread bell and the command
    palette.
  - Completed, Cancelled, Review and Crashed all shared one "Review" section.
    Completed and Cancelled each get their own sidebar section now. Crashed stays
    under Review, because it still needs attention.
  - A pinned Completed or Cancelled status was discarded while a session waited
    for a plan approval or an answer, so the pin did nothing. A pinned terminal
    status now wins over a waiting status. It still does not hide a run that is
    in flight, scheduled, or crashed.
