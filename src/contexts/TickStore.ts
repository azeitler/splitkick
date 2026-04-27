type Listener = (now: number) => void

class TickStore {
  private listeners = new Set<Listener>()
  private intervalId: number | null = null
  private now = Date.now()

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.start()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stop()
    }
  }

  getSnapshot = () => this.now

  private tick = () => {
    this.now = Date.now()
    this.listeners.forEach(l => l(this.now))
  }

  private start() {
    this.tick()
    this.intervalId = window.setInterval(() => {
      if (
        document.visibilityState !== 'visible' ||
        document.documentElement.classList.contains('window-blurred')
      )
        return
      this.tick()
    }, 1000)
  }

  private stop() {
    if (this.intervalId != null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }
}

export const tickStore = new TickStore()
