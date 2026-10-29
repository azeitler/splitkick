import { useEffect, useState } from 'react'

export type FollowUpsPlacement = 'beside' | 'above'

/** Panel width in the side column (`w-80`). */
export const FOLLOW_UPS_PANEL_WIDTH = 320
/** Gap between the chat column and the panel (`ml-3`). */
export const FOLLOW_UPS_PANEL_GAP = 12

/**
 * Where the follow-up list opens (#66). The chat column is centred in its
 * container, so the free space on its right is half of what is left over.
 * The panel goes there when it fits with a gap on both sides; otherwise it
 * floats above the composer.
 */
export function getFollowUpsPlacement({
  containerWidth,
  columnWidth,
  panelWidth = FOLLOW_UPS_PANEL_WIDTH,
  gap = FOLLOW_UPS_PANEL_GAP,
}: {
  containerWidth: number
  columnWidth: number
  panelWidth?: number
  gap?: number
}): FollowUpsPlacement {
  const sideSpace = (containerWidth - columnWidth) / 2
  return sideSpace >= panelWidth + 2 * gap ? 'beside' : 'above'
}

/**
 * Placement for the chat area `container` and its centred `column`. Follows
 * window resizes and every pane that changes the chat area width (sidebar,
 * file browser, browser side pane), because both nodes are observed.
 */
export function useFollowUpsPlacement(
  container: HTMLElement | null,
  column: HTMLElement | null
): FollowUpsPlacement {
  const [placement, setPlacement] = useState<FollowUpsPlacement>('above')

  useEffect(() => {
    if (!container || !column) return
    const update = () =>
      setPlacement(
        getFollowUpsPlacement({
          containerWidth: container.getBoundingClientRect().width,
          columnWidth: column.getBoundingClientRect().width,
        })
      )
    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    observer.observe(column)
    return () => observer.disconnect()
  }, [container, column])

  return placement
}
