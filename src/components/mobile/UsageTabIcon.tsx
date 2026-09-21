import { BarChart3 } from '@/components/icons/reicon'
import { cn } from '@/lib/utils'
import { usageSeverity } from '@/components/preferences/panes/UsagePane'
import { RING_CLASS, type PeakUsage } from '@/components/titlebar/UsagePopover'

const RADIUS = 10.75
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * The Usage tab icon: the chart glyph of the desktop usage badge, with plan
 * usage drawn as a ring around it.
 *
 * The arc is the fullest window across every signed-in backend
 * (`usePeakUsage`), coloured by severity like the desktop badge, so the tab
 * bar answers "how close am I to a limit?" without opening the tab. Without
 * usage data it is the plain glyph, the same size as the other tab icons.
 */
export function UsageTabIcon({ peak }: { peak: PeakUsage | null }) {
  return (
    <span
      className="relative flex size-6 items-center justify-center"
      aria-hidden
    >
      {peak ? (
        <>
          <svg
            viewBox="0 0 24 24"
            data-testid="usage-tab-ring"
            data-percent={Math.round(peak.percent)}
            className={cn(
              'absolute inset-0 size-6 -rotate-90',
              RING_CLASS[usageSeverity(peak.percent)]
            )}
          >
            <circle
              cx="12"
              cy="12"
              r={RADIUS}
              fill="none"
              strokeWidth="1.75"
              className="stroke-foreground/15"
            />
            {peak.percent > 0 && (
              <circle
                cx="12"
                cy="12"
                r={RADIUS}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={CIRCUMFERENCE * (1 - peak.percent / 100)}
                className="transition-[stroke-dashoffset] duration-300"
              />
            )}
          </svg>
          <BarChart3 className="size-3" />
        </>
      ) : (
        <BarChart3 className="size-5" />
      )}
    </span>
  )
}
