import {
  Suspense,
  lazy,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type AnimationEvent,
} from 'react'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { useProjects } from '@/services/projects'
import { useSwipeBack } from '@/hooks/useSwipeBack'
import { JeanLoadingScreen } from '@/components/shared/JeanLoadingScreen'
import { hasQueuedSessionOpen } from './mobile-nav-utils'

const ProjectCanvasView = lazy(() =>
  import('@/components/dashboard/ProjectCanvasView').then(mod => ({
    default: mod.ProjectCanvasView,
  }))
)

/**
 * How the project layer was entered.
 *
 * - `modal`: a project was opened (Home tab, command palette). The canvas rises
 *   from the bottom over the tabs, and a session opened from it pushes on top.
 *   Back from the session returns to the project.
 * - `push`: a *session* was opened straight from a tab (Starred, History, the
 *   unread bell, the palette). The user never looked at the project, so the
 *   canvas stays invisible and the layer lets the tab show through; the session
 *   modal's own slide-in is the push. Back from the session returns to the tab.
 */
export type ProjectLayerEntry = 'modal' | 'push'

interface LayerState {
  projectId: string
  entry: ProjectLayerEntry
  /** `exit` keeps the canvas mounted while it animates away. */
  phase: 'open' | 'exit'
  /**
   * Decided once, when the level opens. Read live, a later `animate` flip would
   * start the rise on a layer that is already on screen.
   */
  animateIn: boolean
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  )
}

/** Back to the tab root: the same two writes as the old Home row. */
function returnToTabRoot(): void {
  useProjectsStore.getState().selectProject(null)
  useChatStore.getState().clearActiveWorktree()
}

/**
 * The project modal of the phone layout.
 *
 * Owns no navigation state. `selectedProjectId` *is* the project level of the
 * stack and `sessionChatModalOpen` is the session level, so every existing way
 * of opening a project or a session — `navigateToSession`, the palette, the
 * unread bell, launch restore — drives this layer without knowing it exists.
 * The layer only decides how the level is presented and animated.
 */
export function MobileProjectLayer({
  animate,
}: {
  /** False until launch restore has painted, so a restored project does not
   *  rise on every app start. */
  animate: boolean
}) {
  const selectedProjectId = useProjectsStore(state => state.selectedProjectId)
  const { data: projects } = useProjects()
  const sessionOpen = useUIStore(state => state.sessionChatModalOpen)

  const [layer, setLayer] = useState<LayerState | null>(() =>
    selectedProjectId
      ? {
          projectId: selectedProjectId,
          entry: 'modal',
          phase: 'open',
          animateIn: false,
        }
      : null
  )
  const [prevProjectId, setPrevProjectId] = useState(selectedProjectId)
  // A swipe already moved the layer off screen; a second exit animation would
  // snap it back first.
  const [skipExit, setSkipExit] = useState(false)

  // Follow `selectedProjectId` during render (React's "adjust state when a prop
  // changes" pattern), so the entry is decided before the first paint.
  if (selectedProjectId !== prevProjectId) {
    setPrevProjectId(selectedProjectId)
    if (selectedProjectId) {
      setSkipExit(false)
      setLayer({
        projectId: selectedProjectId,
        // Read once, at the moment the level opens: `navigateToSession`
        // selects the project and queues the session in the same tick.
        entry: hasQueuedSessionOpen() ? 'push' : 'modal',
        phase: 'open',
        // Switching projects while the layer is up is not a new rise.
        animateIn: animate && (!layer || layer.phase === 'exit'),
      })
    } else if (layer) {
      setLayer(
        skipExit || layer.entry === 'push' || prefersReducedMotion()
          ? null
          : { ...layer, phase: 'exit' }
      )
    }
  }

  // Push entry: closing the session is the way back, and it goes to the tab.
  // A layout effect, so the frame where the session is gone but the project is
  // still selected is never painted. The project id guards against the blip a
  // project switch causes: the old canvas unmounts, clears
  // `sessionChatModalOpen`, and the new one opens it again.
  const openForProjectRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!layer || layer.entry !== 'push' || layer.phase !== 'open') {
      openForProjectRef.current = null
      return
    }
    if (sessionOpen) {
      openForProjectRef.current = layer.projectId
      return
    }
    if (openForProjectRef.current === layer.projectId) {
      openForProjectRef.current = null
      returnToTabRoot()
    }
  }, [layer, sessionOpen])

  const swipeCallback = useCallback(() => {
    setSkipExit(true)
    returnToTabRoot()
  }, [])
  // Destructured so the compiler can tell the ref from the plain render values.
  const {
    containerRef: swipeContainerRef,
    isSwiping,
    translateX,
    transitionStyle,
  } = useSwipeBack({
    onSwipeBack: swipeCallback,
    // The session modal claims its own edge swipe (it stops propagation), so
    // this only ever fires with the project itself on screen.
    enabled: layer?.entry === 'modal' && layer.phase === 'open' && !sessionOpen,
  })

  const handleAnimationEnd = useCallback((event: AnimationEvent) => {
    // Descendants animate too, and their events bubble.
    if (event.target !== event.currentTarget) return
    setLayer(current => (current?.phase === 'exit' ? null : current))
  }, [])

  if (!layer) return null

  const isPush = layer.entry === 'push'
  const project = projects?.find(p => p.id === layer.projectId)
  const exiting = layer.phase === 'exit'

  return (
    <div
      ref={swipeContainerRef}
      data-testid="mobile-project-layer"
      data-entry={layer.entry}
      data-phase={layer.phase}
      onAnimationEnd={handleAnimationEnd}
      className={cn(
        // Over the tab bar (z-[1]) but under the corner FloatingDock (z-10),
        // which must stay reachable inside a project as it was before. The
        // z-index also contains the canvas's own z-indexes in this layer.
        'absolute inset-0 z-[2] flex flex-col',
        // Push: the tab shows through until the session slides in over it.
        isPush ? 'pointer-events-none' : 'bg-background shadow-2xl',
        !isPush &&
          layer.animateIn &&
          !exiting &&
          'motion-safe:animate-in motion-safe:slide-in-from-bottom motion-safe:duration-300 motion-safe:ease-out',
        exiting &&
          'pointer-events-none animate-out slide-out-to-bottom duration-200 ease-in [animation-fill-mode:forwards]'
      )}
      style={
        isSwiping || translateX !== 0
          ? {
              transform: `translateX(${translateX}px)`,
              transition: transitionStyle || undefined,
              willChange: isSwiping ? 'transform' : undefined,
            }
          : undefined
      }
    >
      <Suspense fallback={isPush ? null : <JeanLoadingScreen />}>
        {project ? (
          <ProjectCanvasView
            key={layer.projectId}
            projectId={layer.projectId}
            project={project}
            mobilePresentation={layer.entry}
            onDismiss={returnToTabRoot}
          />
        ) : isPush ? null : (
          <JeanLoadingScreen />
        )}
      </Suspense>
    </div>
  )
}
