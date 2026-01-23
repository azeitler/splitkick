import { cn } from '@/lib/utils'

interface BorderSpinnerProps {
  shape: 'square' | 'circle'
  className?: string
  bgClassName?: string
}

export function BorderSpinner({ shape, className, bgClassName }: BorderSpinnerProps) {
  // Perimeter: circle ≈ 22, square ≈ 28
  const perimeter = shape === 'circle' ? 22 : 28

  return (
    <svg
      viewBox="0 0 8 8"
      className={cn('shrink-0', className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {shape === 'circle' ? (
        <>
          {/* Background circle */}
          <circle cx="4" cy="4" r="3.5" className={bgClassName} />
          {/* Animated stroke */}
          <circle
            cx="4"
            cy="4"
            r="3.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="animate-border-spin"
            style={{
              strokeDasharray: `${perimeter * 0.3} ${perimeter * 0.7}`,
              strokeDashoffset: perimeter,
            }}
          />
        </>
      ) : (
        <>
          {/* Background square */}
          <rect x="0.5" y="0.5" width="7" height="7" rx="1.5" className={bgClassName} />
          {/* Animated stroke */}
          <rect
            x="0.5"
            y="0.5"
            width="7"
            height="7"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="animate-border-spin"
            style={{
              strokeDasharray: `${perimeter * 0.3} ${perimeter * 0.7}`,
              strokeDashoffset: perimeter,
            }}
          />
        </>
      )}
    </svg>
  )
}
