# Mobile layout (smartphone / Web Access on a phone)

Jean's phone layout is reached almost always through **Web Access**: the user
opens Jean in mobile Safari or Chrome and talks to the desktop app over the
WebSocket transport. `isNativeApp()` is therefore `false` on a phone, and
"mobile" is a pure width test — `useIsMobile()` (`src/hooks/use-mobile.ts`,
`MOBILE_BREAKPOINT = 768`). There is no user-agent or platform check anywhere.

There is no `MobileLayout` component. The phone shell is assembled in
`MainWindow.tsx`: the desktop in-flow sidebars are replaced by two left
`Sheet` drawers (`MobileLeftSidebar`, `MobileFileBrowser`), the chat toolbar
swaps its desktop controls for `MobileToolbarMenu` / `MobileSettingsMenu` /
`MobileBackendModelPickerSheet`, and edge swipes provide navigation.

## Conventions

Use these rather than inventing new ones. Each already has precedent in the
tree, and `src/components/touch-affordances.test.ts` plus
`src/components/mobile-dialog-responsive.test.ts` guard them.

### Pair `md:` with `isMobile`, never `sm:`

`useIsMobile()` is 768px but Tailwind `sm:` is 640px. Mixing them on one element
produces a half-mobile layout between 640 and 767px — the chat composer used to
show the desktop floating card _and_ the mobile safe-area padding, i.e. a
detached card with a gap under it. Anything that visually pairs with the JS
`isMobile` must use `md:`. Pure typography polish may keep `sm:`.

### Dialogs

Large dialogs go full-screen on a phone and keep their desktop size from `sm:`
up:

```
!w-screen !h-dvh !max-w-screen !max-h-none !rounded-none p-4
sm:!w-[90vw] sm:!max-w-7xl sm:!h-[85dvh] sm:!rounded-lg sm:p-6
```

If the dialog also bleeds its ScrollArea or footer past the padding
(`-mx-6 px-6`), match the mobile padding too (`-mx-4 px-4 sm:-mx-6 sm:px-6`).

Small dialogs need no phone treatment, but **never leave a `max-w-*` or
`min-w-*` unprefixed**: `DialogContent`'s base `max-w-[calc(100%-2rem)]` is what
keeps the 16px phone gutter, and an unprefixed override kills it. A
`min-w-[90vw]` beats it outright and forces horizontal overflow.

Use `dvh`, never `vh`. On iOS Safari `vh` exceeds the visible viewport, so a
centred dialog is clipped top and bottom.

### Hover affordances

A row action revealed only by `group-hover` is invisible and unreachable on a
phone. Use the CSS-only variant — no hook, no re-render, and correct on touch
laptops too:

```
[@media(pointer:fine)]:opacity-0 [@media(pointer:fine)]:group-hover:opacity-100
```

Watch for a sibling state class: `cn('opacity-0 group-hover:opacity-100', isActive && 'opacity-50')`
cannot simply gain the variants, because both survive `twMerge` and the variant
wins the cascade — the active item would then vanish on desktop. Branch with a
ternary instead (see `TerminalView.tsx`).

### Touch targets

Aim for 44px on anything a phone user must reach. Do **not** change the `Button`
size variants — they are load-bearing for the whole desktop chrome.

- Where the control has room around it, grow the hit area and leave the visual
  box alone: `after:absolute after:-inset-2 md:after:hidden`
  (`ui/sidebar.tsx`, `ui/dialog.tsx`, `ui/sheet.tsx`).
- Where neighbours are closer than 16px, that trick makes one button steal the
  next one's edge taps. Grow the visual box instead, mobile-only —
  `size-11 md:size-6` in the title bar, `isMobile ? 'h-11' : 'h-8'` in
  `SendCancelButton`.

Tooltips are suppressed centrally on coarse pointers
(`[@media(pointer:coarse)]:hidden` in `ui/tooltip.tsx`) because Radix opens them
on focus, so a tap used to leave one stuck over the UI. Every tooltip trigger
therefore needs its own `aria-label`.

### Safe areas and the title bar

`--safe-area-top/right/bottom/left` are declared in `App.css`. The title bar is
an absolute overlay, so its height and `MainWindow`'s content offset must agree:
both read `--titlebar-height`, which folds in the top inset and is 2.75rem below
the breakpoint (for the 44px buttons) and 2rem above it. Never write a literal
height on either side.

The bottom inset belongs on whichever element is actually bottom-anchored, and
only while the soft keyboard is closed — see below.

### The soft keyboard

iOS Safari ignores `interactive-widget=resizes-content` and does not shrink
`dvh` for the keyboard, so a bottom-anchored surface inside the `h-dvh
overflow-hidden` shell ends up underneath it. Two surfaces compensate, both with
`useVisualViewportBottomInset(ref, !isNativeApp() || isMobile)`:

- the chat column in `ChatWindow.tsx`
- the terminal root in `TerminalView.tsx`

Measure **per surface**, not once at the shell root. The two are siblings, so
when the terminal drawer is open the chat column's bottom is already above the
keyboard and its inset measures 0 — no double compensation. Padding the shell
root instead would make the terminal's own inset read 0, flip its
`keyboardOpen` to false, and let `TerminalExtraKeysBar` re-add a 34px dead gap
above the keyboard.

Pad an element that is `h-full` inside a fixed-height chain, so the padding
cannot move the element's own bottom edge and start a measure/pad loop. Drop
`var(--safe-area-bottom)` while the inset is non-zero. If the surface scrolls,
re-stick to the tail after the shrink, reading "am I at the bottom" through a
ref so the effect does not re-run on every flip.

### Mobile web is not the native app

`body.native-app` carries the desktop-only `user-select: none` and
`cursor: default`. Overscroll control is _not_ in there: `html, body {
overscroll-behavior: none }` applies everywhere, because Chrome Android
pull-to-refresh competes with Jean's swipe-down-opens-the-command-palette
gesture, and the shell never scrolls the body anyway.

The two left drawers are both `Sheet side="left"`, so their stacking cannot be
left to DOM order — the lazily-portalled file browser would always win and dim
the primary navigation. `MobileFileBrowser` sits one layer down via
`z-[78]` on both content and `overlayClassName`.

Keyboard-only affordances are native-desktop only: hide `<Kbd>` hints and
disable the matching handlers in web access and on mobile (gate on
`isNativeApp()` plus `useIsMobile()`).

## Testing

There is no phone-viewport Playwright project; `e2e/tests/preferences.spec.ts`
actually widens to 1280x720 to _escape_ the mobile layout. Mobile behaviour is
covered by unit tests:

- `src/components/touch-affordances.test.ts` — hover variants, tooltips, hit
  areas, drawer layering, `md:`/`isMobile` parity
- `src/components/mobile-dialog-responsive.test.ts` — dialog sizing, `dvh`,
  gutters
- `src/components/titlebar/TitleBar.safe-area.test.ts` — bar height,
  safe areas, overscroll
- `src/components/chat/ChatWindow.keyboard-inset.test.ts` and
  `src/hooks/useVisualViewportBottomInset.test.ts` — soft keyboard
- `src/components/layout/MobileLeftSidebar.test.tsx`,
  `MainWindowContent.mobile-swipe.test.tsx`, `src/hooks/useSwipeBack.test.tsx` —
  drawers and gestures
