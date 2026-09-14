import { cn } from '@/lib/utils'

/** Shared frame for the Home sections and the project columns that mirror them. */
export function HomeSection({
  title,
  action,
  className,
  children,
}: {
  title: string
  action?: React.ReactNode
  /** Set where the section must take a share of its column, e.g. `flex-1`. */
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn('flex w-full min-w-0 flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
