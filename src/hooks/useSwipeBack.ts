import { useCallback, useEffect, useRef, useState } from 'react'

interface SwipeBackOptions {
  onSwipeBack: () => void
  enabled?: boolean
  edgeWidth?: number
  threshold?: number
}

interface SwipeBackResult {
  containerRef: React.RefObject<HTMLDivElement | null>
  translateX: number
  isSwiping: boolean
  transitionStyle: string
}

export function useSwipeBack({
  onSwipeBack,
  enabled = true,
  edgeWidth = 24,
  threshold = 0.35,
}: SwipeBackOptions): SwipeBackResult {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [translateX, setTranslateX] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)
  const [transitionStyle, setTransitionStyle] = useState('')

  const startXRef = useRef(0)
  const startTimeRef = useRef(0)
  const lastXRef = useRef(0)
  const lastTimeRef = useRef(0)
  const swipingRef = useRef(false)
  const firedRef = useRef(false)

  const onSwipeBackRef = useRef(onSwipeBack)
  useEffect(() => {
    onSwipeBackRef.current = onSwipeBack
  }, [onSwipeBack])

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (firedRef.current) return
      const touch = e.touches[0]
      if (!touch || touch.clientX > edgeWidth) return

      startXRef.current = touch.clientX
      startTimeRef.current = Date.now()
      lastXRef.current = touch.clientX
      lastTimeRef.current = Date.now()
      swipingRef.current = true
      setIsSwiping(true)
      setTransitionStyle('')
    },
    [edgeWidth]
  )

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!swipingRef.current) return
    if (e.cancelable) e.preventDefault()

    const touch = e.touches[0]
    if (!touch) return
    const deltaX = Math.max(0, touch.clientX - startXRef.current)
    setTranslateX(deltaX)
    lastXRef.current = touch.clientX
    lastTimeRef.current = Date.now()
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (!swipingRef.current) return
    swipingRef.current = false

    const container = containerRef.current
    if (!container) {
      setIsSwiping(false)
      setTranslateX(0)
      return
    }

    const containerWidth = container.offsetWidth
    const elapsed = Date.now() - startTimeRef.current
    const velocity =
      elapsed > 0
        ? ((lastXRef.current - startXRef.current) / elapsed) * 1000
        : 0
    const currentTranslateX = lastXRef.current - startXRef.current
    const shouldComplete =
      currentTranslateX > containerWidth * threshold || velocity > 500

    setTransitionStyle('transform 200ms ease-out')

    if (shouldComplete) {
      setTranslateX(containerWidth)
      firedRef.current = true
      setTimeout(() => {
        onSwipeBackRef.current()
        // Reset after callback
        setTranslateX(0)
        setIsSwiping(false)
        setTransitionStyle('')
        firedRef.current = false
      }, 200)
    } else {
      setTranslateX(0)
      setTimeout(() => {
        setIsSwiping(false)
        setTransitionStyle('')
      }, 200)
    }
  }, [threshold])

  useEffect(() => {
    if (!enabled) return
    const el = containerRef.current
    if (!el) return

    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchmove', handleTouchMove, { passive: false })
    el.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('touchend', handleTouchEnd)
    }
  }, [enabled, handleTouchStart, handleTouchMove, handleTouchEnd])

  return { containerRef, translateX, isSwiping, transitionStyle }
}
