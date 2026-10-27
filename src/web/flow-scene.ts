// Background scene for the calm screens (login, projects): cards drifting through the five board
// columns, tinted by the column they cross. Loaded with a dynamic import so the board never pays for three.js.
import * as THREE from "three"

const STATUS_VARS = ["--st-idea", "--st-ready", "--st-in_progress", "--st-review", "--st-done"]
const COUNT = 42
const SPAN = 26 // world units from the leftmost to the rightmost column

export type FlowScene = { setEnergy(value: number): void; dispose(): void }

function cardShape(w: number, h: number, r: number) {
  const s = new THREE.Shape()
  s.moveTo(-w / 2 + r, -h / 2)
  s.lineTo(w / 2 - r, -h / 2)
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r)
  s.lineTo(w / 2, h / 2 - r)
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2)
  s.lineTo(-w / 2 + r, h / 2)
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r)
  s.lineTo(-w / 2, -h / 2 + r)
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2)
  return s
}

function readPalette() {
  const css = getComputedStyle(document.documentElement)
  const color = (name: string) => new THREE.Color(css.getPropertyValue(name).trim() || "#888")
  return {
    bg: color("--bg"),
    surface: color("--surface"),
    accent: color("--accent"),
    status: STATUS_VARS.map(color),
  }
}

export function startFlowScene(canvas: HTMLCanvasElement, reducedMotion: boolean): FlowScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "low-power" })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
  camera.position.set(0, 0, 18)

  let palette = readPalette()
  scene.fog = new THREE.Fog(palette.bg, 16, 34)
  renderer.setClearColor(palette.bg)
  scene.add(new THREE.AmbientLight(0xffffff, 1.6))
  const sun = new THREE.DirectionalLight(0xffffff, 2.2)
  sun.position.set(-4, 6, 10)
  scene.add(sun)

  const geometry = new THREE.ExtrudeGeometry(cardShape(1.7, 1.05, 0.16), {
    depth: 0.06,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.03,
    bevelSegments: 2,
    curveSegments: 6,
  })
  geometry.center()
  const material = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 })
  const cards = new THREE.InstancedMesh(geometry, material, COUNT)
  scene.add(cards)

  const rand = (min: number, max: number) => min + Math.random() * (max - min)
  const state = Array.from({ length: COUNT }, () => ({
    t: Math.random(),
    // Keep a calm band in the middle where the page content sits.
    lane: (Math.random() < 0.5 ? -1 : 1) * rand(2.2, 6),
    depth: rand(-12, 0),
    speed: rand(0.012, 0.03),
    phase: rand(0, Math.PI * 2),
    hover: 0,
  }))

  const pointer = new THREE.Vector2(10, 10)
  const look = new THREE.Vector2()
  const raycaster = new THREE.Raycaster()
  const dummy = new THREE.Object3D()
  const tint = new THREE.Color()
  let energy = 1
  let energyTarget = 1
  let hovered = -1
  let frame = 0
  let last = performance.now()

  const onPointer = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect()
    pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
  }
  window.addEventListener("pointermove", onPointer)

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas
    if (!w || !h) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()

  const scheme = matchMedia("(prefers-color-scheme: dark)")
  const onScheme = () => {
    palette = readPalette()
    renderer.setClearColor(palette.bg)
    ;(scene.fog as THREE.Fog).color.copy(palette.bg)
  }
  scheme.addEventListener("change", onScheme)

  const render = (now: number) => {
    // A background does not need 60 fps: ~30 halves the GPU cost (and the CPU cost on software WebGL).
    if (now - last < 30 && !reducedMotion) {
      frame = document.hidden ? 0 : requestAnimationFrame(render)
      return
    }
    const dt = Math.min((now - last) / 1000, 0.05)
    last = now
    energy += (energyTarget - energy) * Math.min(dt * 3, 1)

    // Gentle parallax: the camera leans toward the pointer.
    look.lerp(new THREE.Vector2(pointer.x, pointer.y).clampScalar(-1, 1), Math.min(dt * 2, 1))
    camera.position.x = look.x * 1.6
    camera.position.y = look.y * 1.0
    camera.lookAt(0, 0, 0)

    raycaster.setFromCamera(pointer, camera)
    hovered = raycaster.intersectObject(cards)[0]?.instanceId ?? -1

    for (let i = 0; i < COUNT; i++) {
      const s = state[i] as (typeof state)[number]
      if (!reducedMotion) s.t = (s.t + s.speed * dt * energy) % 1
      s.hover += ((i === hovered ? 1 : 0) - s.hover) * Math.min(dt * 8, 1)
      const x = (s.t - 0.5) * SPAN
      const wobble = Math.sin(now / 1400 + s.phase)
      dummy.position.set(x, s.lane + Math.sin(s.t * Math.PI * 2 + s.phase) * 0.5, s.depth + s.hover * 1.5)
      dummy.rotation.set(
        -0.25 + wobble * 0.08 + look.y * 0.2 - s.hover * 0.25 * look.y,
        0.35 * Math.sin(s.phase) + look.x * 0.25 - s.hover * 0.3,
        wobble * 0.05,
      )
      // Cards fade in at the left edge and out at the right, like work entering and leaving the board.
      const edge = Math.min(s.t / 0.08, (1 - s.t) / 0.08, 1)
      dummy.scale.setScalar((0.3 + 0.55 * edge) * (1 + s.hover * 0.35))
      dummy.updateMatrix()
      cards.setMatrixAt(i, dummy.matrix)

      const column = s.t * (palette.status.length - 1)
      const from = palette.status[Math.floor(column)] as THREE.Color
      const to = palette.status[Math.ceil(column)] as THREE.Color
      tint.copy(from).lerp(to, column % 1)
      cards.setColorAt(
        i,
        tint.lerp(palette.surface, 0.68 - s.hover * 0.5).lerp(palette.accent, s.hover * 0.3),
      )
    }
    cards.instanceMatrix.needsUpdate = true
    if (cards.instanceColor) cards.instanceColor.needsUpdate = true
    renderer.render(scene, camera)
    frame = reducedMotion || document.hidden ? 0 : requestAnimationFrame(render)
  }
  const onVisibility = () => {
    if (!document.hidden && !frame && !reducedMotion) frame = requestAnimationFrame(render)
  }
  document.addEventListener("visibilitychange", onVisibility)
  frame = requestAnimationFrame(render)

  return {
    setEnergy(value) {
      energyTarget = value
    },
    dispose() {
      cancelAnimationFrame(frame)
      window.removeEventListener("pointermove", onPointer)
      document.removeEventListener("visibilitychange", onVisibility)
      scheme.removeEventListener("change", onScheme)
      observer.disconnect()
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    },
  }
}
