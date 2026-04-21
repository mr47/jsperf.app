import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useRef, useEffect, useState } from 'react'
import { useTheme } from 'next-themes'

// One ASCII character cell == CELL_SIZE × ROW_HEIGHT in CSS pixels.
// We render the WebGL scene at exactly (cols × rows) backbuffer pixels
// — one backbuffer pixel per character cell — and CSS-stretch that
// canvas back up with `image-rendering: pixelated`. Result: each ASCII
// character is colored by exactly one rendered pixel, with perfect
// alignment when CELL_SIZE evenly divides the container width.
const TARGET_FPS = 25
const CELL_SIZE = 8        // CSS px per ASCII column (char advance)
const ROW_HEIGHT = 16      // CSS px per ASCII row (line height)
const FONT_SIZE = 14       // SVG font-size used inside the mask
const CHAR_SET = ' .:-+*=%@#'
// How often to rebuild the character-density mask from scene brightness.
// The scene rotates slowly, so 4 Hz is plenty and keeps DOM churn low.
const MASK_REFRESH_MS = 1000 / TARGET_FPS

function FrameThrottler({ paused }) {
  const { invalidate } = useThree()

  useEffect(() => {
    if (paused) return
    let id
    const interval = 1000 / TARGET_FPS
    const tick = () => {
      invalidate()
      id = setTimeout(tick, interval)
    }
    tick()
    return () => clearTimeout(id)
  }, [paused, invalidate])

  return null
}

// GPU-accelerated ASCII renderer using an SVG character mask.
//
// Inspired by https://github.com/DeoVolenteGames/ascii-renderer
//
// Why this is fast: AsciiEffect from three-stdlib reads back every
// pixel from the GPU and builds a `<span style="color:...">X</span>`
// per cell into innerHTML — ~600KB of HTML parsed per frame at our
// viewport. Here we instead let the GPU do all per-frame work and
// only rebuild the mask occasionally (and never per-cell color).
//
// Brightness-adaptive variant: we read back the tiny (cols × rows)
// backbuffer via gl.readPixels, pick a denser character for brighter
// pixels, and rebuild the SVG mask. Throttled to MASK_REFRESH_MS so
// the rebuild cost doesn't dominate the frame budget.
function SvgMaskAsciiRenderer({ characters = CHAR_SET, refreshMs = MASK_REFRESH_MS }) {
  const { size, gl } = useThree()
  const cols = Math.max(1, Math.floor(size.width / CELL_SIZE))
  const rows = Math.max(1, Math.floor(size.height / ROW_HEIGHT))

  // Mutable per-instance state we don't want to rebuild each render.
  const refs = useRef({
    pixelBuf: null,
    lastRefreshAt: 0,
    svgPrefix: '',
    svgSuffix: '',
  })

  useEffect(() => {
    const c = gl.domElement
    c.style.position = 'absolute'
    c.style.top = '0'
    c.style.left = '0'
    c.style.width = '100%'
    c.style.height = '100%'
    c.style.opacity = '1'
    c.style.imageRendering = 'pixelated'
    c.style.pointerEvents = 'none'
    c.style.maskMode = 'luminance'
    c.style.webkitMaskMode = 'luminance'
    c.style.maskRepeat = 'no-repeat'
    c.style.webkitMaskRepeat = 'no-repeat'
    c.style.contain = 'paint'
    return () => {
      c.style.imageRendering = ''
      c.style.maskImage = ''
      c.style.webkitMaskImage = ''
    }
  }, [gl])

  useEffect(() => {
    if (size.width <= 0 || size.height <= 0) return
    refs.current.pixelBuf = new Uint8Array(cols * rows * 4)
    refs.current.lastRefreshAt = 0 // force immediate rebuild on next frame
    refs.current.svgPrefix =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}">` +
      `<text fill="white" font-family="Courier New, monospace" font-size="${FONT_SIZE}" xml:space="preserve">`
    refs.current.svgSuffix = `</text></svg>`
  }, [size.width, size.height, cols, rows])

  // Priority-1 useFrame takes over rendering from r3f so we can
  // readPixels straight after the render with consistent timing.
  useFrame((state) => {
    const c = gl.domElement

    // r3f may resize our backbuffer back up to container size on
    // resize events — re-clamp it to one pixel per char cell.
    if (c.width !== cols || c.height !== rows) {
      gl.setSize(cols, rows, false)
      c.style.width = '100%'
      c.style.height = '100%'
    }

    gl.render(state.scene, state.camera)

    const now = performance.now()
    if (now - refs.current.lastRefreshAt < refreshMs) return
    refs.current.lastRefreshAt = now

    const buf = refs.current.pixelBuf
    if (!buf || buf.length !== cols * rows * 4) return

    const ctx = gl.getContext()
    try {
      ctx.readPixels(0, 0, cols, rows, ctx.RGBA, ctx.UNSIGNED_BYTE, buf)
    } catch (e) {
      return
    }

    const charSet = (characters || '').replace(/[^\S ]/g, '') || '01'
    const lastIdx = charSet.length - 1

    let body = ''
    // WebGL pixel data is bottom-up; iterate rows in reverse to flip Y.
    for (let yy = 0; yy < rows; yy++) {
      const y = rows - 1 - yy
      const base = y * cols * 4
      let row = ''
      for (let x = 0; x < cols; x++) {
        const i = base + x * 4
        const a = buf[i + 3]
        const bright = a === 0
          ? 0
          : (0.3 * buf[i] + 0.59 * buf[i + 1] + 0.11 * buf[i + 2]) / 255
        let idx = Math.floor(bright * lastIdx)
        if (idx < 0) idx = 0
        else if (idx > lastIdx) idx = lastIdx
        let ch = charSet[idx]
        if (ch === ' ') ch = '\u00A0'
        else if (ch === '<') ch = '&lt;'
        else if (ch === '>') ch = '&gt;'
        else if (ch === '&') ch = '&amp;'
        row += ch
      }
      const dy = yy === 0 ? Math.round(FONT_SIZE * 0.9) : ROW_HEIGHT
      body += `<tspan x="0" dy="${dy}" xml:space="preserve">${row}</tspan>`
    }

    const svg = refs.current.svgPrefix + body + refs.current.svgSuffix
    const uri = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
    c.style.maskImage = uri
    c.style.webkitMaskImage = uri
  }, 1)

  return null
}

function CoolShape() {
  const ref = useRef()

  useFrame((state, delta) => {
    if (!ref.current) return
    ref.current.rotation.x += delta * 0.15
    ref.current.rotation.y += delta * 0.2
    ref.current.rotation.z += delta * 0.1
  })

  return (
    <mesh ref={ref}>
      <torusKnotGeometry args={[10, 2.5, 24, 8, 2, 3]} />
      <meshStandardMaterial
        color="#ffffff"
        roughness={0.1}
        metalness={0.9}
      />
    </mesh>
  )
}

export default function HeroBackground() {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [visible, setVisible] = useState(true)
  const [tabVisible, setTabVisible] = useState(true)
  const containerRef = useRef(null)

  useEffect(() => {
    setMounted(true)

    const mq = window.matchMedia('(max-width: 768px)')
    setIsMobile(mq.matches)
    const mqHandler = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', mqHandler)

    const rmq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(rmq.matches)
    const rmqHandler = (e) => setReducedMotion(e.matches)
    rmq.addEventListener('change', rmqHandler)

    const visHandler = () => setTabVisible(!document.hidden)
    document.addEventListener('visibilitychange', visHandler)

    return () => {
      mq.removeEventListener('change', mqHandler)
      rmq.removeEventListener('change', rmqHandler)
      document.removeEventListener('visibilitychange', visHandler)
    }
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [mounted])

  if (!mounted) return null

  const paused = !visible || !tabVisible || reducedMotion

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 -z-10 h-full w-full overflow-hidden opacity-90 dark:opacity-100 pointer-events-none flex items-center justify-center"
      style={{
        maskImage: 'radial-gradient(ellipse at center, black, transparent 75%)',
        WebkitMaskImage: 'radial-gradient(ellipse at center, black, transparent 75%)',
        // Promote this subtree to its own GPU compositor layer so the
        // ASCII repaints don't dirty the cards/modal/header above.
        contain: 'content',
        isolation: 'isolate',
        willChange: 'transform',
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden',
      }}
    >
      {isMobile || reducedMotion ? (
        <div className="relative w-full h-full opacity-60">
          <div className={`absolute top-[20%] left-[10%] w-64 h-64 rounded-full blur-[100px] ${resolvedTheme === 'dark' ? 'bg-[#00ffff]/40' : 'bg-[#0ea5e9]/40'}`} />
          <div className={`absolute bottom-[20%] right-[10%] w-64 h-64 rounded-full blur-[100px] ${resolvedTheme === 'dark' ? 'bg-[#ff00ff]/40' : 'bg-[#d946ef]/40'}`} />
          <div className={`absolute top-[40%] left-[50%] w-48 h-48 -translate-x-1/2 rounded-full blur-[80px] ${resolvedTheme === 'dark' ? 'bg-[#8a2be2]/40' : 'bg-transparent'}`} />
        </div>
      ) : (
        <Canvas
          frameloop="demand"
          dpr={1}
          camera={{ position: [0, 0, 30] }}
          gl={{
            powerPreference: 'low-power',
            antialias: false,
            stencil: false,
            depth: true,
            alpha: true,
            preserveDrawingBuffer: false,
          }}
        >
          <FrameThrottler paused={paused} />

          <ambientLight intensity={0.3} />
          <directionalLight position={[10, 10, 10]} color={resolvedTheme === 'dark' ? '#00ffff' : '#0ea5e9'} intensity={5} />
          <directionalLight position={[-10, -10, 10]} color={resolvedTheme === 'dark' ? '#ff00ff' : '#d946ef'} intensity={5} />
          <directionalLight position={[0, 0, -10]} color={resolvedTheme === 'dark' ? '#8a2be2' : '#ffffff'} intensity={2} />

          <CoolShape />

          <SvgMaskAsciiRenderer characters={CHAR_SET} />
        </Canvas>
      )}
    </div>
  )
}
