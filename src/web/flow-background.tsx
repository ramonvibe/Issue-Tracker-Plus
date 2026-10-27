import { useEffect, useRef } from "react"
import type { FlowScene } from "./flow-scene.ts"
import { usePrefersReducedMotion } from "./ui.tsx"

// Full-screen three.js backdrop. `energy` speeds the flow up (e.g. while a project card is hovered).
export function FlowBackground({ energy = 1 }: { energy?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const scene = useRef<FlowScene | null>(null)
  const reducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    let disposed = false
    import("./flow-scene.ts")
      .then(({ startFlowScene }) => {
        if (disposed || !canvas.current) return
        scene.current = startFlowScene(canvas.current, reducedMotion)
        canvas.current.dataset.ready = "true"
      })
      // No WebGL (old GPU, locked-down browser): the page simply keeps its flat background.
      .catch(() => {})
    return () => {
      disposed = true
      scene.current?.dispose()
      scene.current = null
    }
  }, [reducedMotion])

  useEffect(() => scene.current?.setEnergy(energy), [energy])

  return (
    <>
      <canvas
        ref={canvas}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-20 size-full opacity-0 transition-opacity duration-1000 data-[ready=true]:opacity-100"
      />
      {/* Vignette: keeps the centre, where the content is, quiet and readable. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 [background:radial-gradient(ellipse_55%_60%_at_50%_45%,var(--bg)_25%,transparent_80%)]"
      />
    </>
  )
}
