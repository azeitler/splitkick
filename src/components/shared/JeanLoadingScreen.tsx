import { PRODUCT_NAME } from '@/lib/build-info'

/**
 * A view that is still loading. The same spinning notch as the start
 * skeleton in index.html (#72), so the hand-over from the skeleton to a view
 * that loads its code does not flash a text.
 */
export function JeanLoadingScreen() {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background">
      <p role="status" className="sr-only">
        Loading {PRODUCT_NAME}...
      </p>
      <div
        aria-hidden
        className="size-7 rounded-full border-[2.5px] border-border border-t-muted-foreground animate-spin motion-reduce:[animation-duration:2.4s]"
      />
    </div>
  )
}
