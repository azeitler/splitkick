import * as React from 'react'

const MOBILE_BREAKPOINT = 768

/** Same test as `useIsMobile`, for code outside React. */
export function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(
    () => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT
  )

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener('change', onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
