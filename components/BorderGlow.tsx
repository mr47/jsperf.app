import { CSSProperties, ReactNode, useCallback, useEffect, useRef } from 'react'
import styles from './BorderGlow.module.css'

type GlowVars = CSSProperties & Record<`--${string}`, string | number>

type BorderGlowProps = {
  children: ReactNode
  className?: string
  edgeSensitivity?: number
  glowColor?: string
  backgroundColor?: string
  borderRadius?: number
  glowRadius?: number
  glowIntensity?: number
  coneSpread?: number
  animated?: boolean
  colors?: string[]
  fillOpacity?: number
}

type HslColor = {
  h: number
  s: number
  l: number
}

type AnimateValueOptions = {
  start?: number
  end?: number
  duration?: number
  delay?: number
  ease?: (x: number) => number
  onUpdate: (value: number) => void
  onEnd?: () => void
}

const DEFAULT_COLORS = ['#c084fc', '#f472b6', '#38bdf8']
const GRADIENT_POSITIONS = ['80% 55%', '69% 34%', '8% 6%', '41% 38%', '86% 85%', '82% 18%', '51% 4%']
const GRADIENT_KEYS = [
  '--gradient-one',
  '--gradient-two',
  '--gradient-three',
  '--gradient-four',
  '--gradient-five',
  '--gradient-six',
  '--gradient-seven',
] as const
const COLOR_MAP = [0, 1, 2, 0, 1, 2, 1]

function parseHSL(hslStr: string): HslColor {
  const match = hslStr.match(/([\d.]+)\s*([\d.]+)%?\s*([\d.]+)%?/)

  if (!match) return { h: 40, s: 80, l: 80 }

  return {
    h: parseFloat(match[1]),
    s: parseFloat(match[2]),
    l: parseFloat(match[3]),
  }
}

function buildGlowVars(glowColor: string, intensity: number): GlowVars {
  const { h, s, l } = parseHSL(glowColor)
  const base = `${h}deg ${s}% ${l}%`
  const opacities = [100, 60, 50, 40, 30, 20, 10]
  const keys = ['', '-60', '-50', '-40', '-30', '-20', '-10']
  const vars: GlowVars = {}

  for (let i = 0; i < opacities.length; i++) {
    vars[`--glow-color${keys[i]}`] = `hsl(${base} / ${Math.min(opacities[i] * intensity, 100)}%)`
  }

  return vars
}

function buildGradientVars(colors: string[]): GlowVars {
  const palette = colors.length > 0 ? colors : DEFAULT_COLORS
  const vars: GlowVars = {}

  for (let i = 0; i < GRADIENT_KEYS.length; i++) {
    const color = palette[Math.min(COLOR_MAP[i], palette.length - 1)]
    vars[GRADIENT_KEYS[i]] = `radial-gradient(at ${GRADIENT_POSITIONS[i]}, ${color} 0px, transparent 50%)`
  }

  vars['--gradient-base'] = `linear-gradient(${palette[0]} 0 100%)`

  return vars
}

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3)
}

function easeInCubic(x: number): number {
  return x * x * x
}

function animateValue({
  start = 0,
  end = 100,
  duration = 1000,
  delay = 0,
  ease = easeOutCubic,
  onUpdate,
  onEnd,
}: AnimateValueOptions): () => void {
  const t0 = performance.now() + delay
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let frameId: number | undefined
  let cancelled = false

  function tick() {
    if (cancelled) return

    const elapsed = performance.now() - t0
    const t = Math.min(elapsed / duration, 1)
    onUpdate(start + (end - start) * ease(t))

    if (t < 1) {
      frameId = requestAnimationFrame(tick)
    } else if (onEnd) {
      onEnd()
    }
  }

  timeoutId = setTimeout(() => {
    frameId = requestAnimationFrame(tick)
  }, delay)

  return () => {
    cancelled = true
    if (timeoutId) clearTimeout(timeoutId)
    if (frameId) cancelAnimationFrame(frameId)
  }
}

export default function BorderGlow({
  children,
  className = '',
  edgeSensitivity = 30,
  glowColor = '40 80 80',
  backgroundColor = '#120F17',
  borderRadius = 28,
  glowRadius = 40,
  glowIntensity = 1.0,
  coneSpread = 25,
  animated = false,
  colors = DEFAULT_COLORS,
  fillOpacity = 0.5,
}: BorderGlowProps) {
  const cardRef = useRef<HTMLDivElement>(null)

  const getCenterOfElement = useCallback((el: HTMLElement) => {
    const { width, height } = el.getBoundingClientRect()
    return [width / 2, height / 2]
  }, [])

  const getEdgeProximity = useCallback((el: HTMLElement, x: number, y: number) => {
    const [cx, cy] = getCenterOfElement(el)
    const dx = x - cx
    const dy = y - cy
    let kx = Infinity
    let ky = Infinity

    if (dx !== 0) kx = cx / Math.abs(dx)
    if (dy !== 0) ky = cy / Math.abs(dy)

    return Math.min(Math.max(1 / Math.min(kx, ky), 0), 1)
  }, [getCenterOfElement])

  const getCursorAngle = useCallback((el: HTMLElement, x: number, y: number) => {
    const [cx, cy] = getCenterOfElement(el)
    const dx = x - cx
    const dy = y - cy

    if (dx === 0 && dy === 0) return 0

    const radians = Math.atan2(dy, dx)
    let degrees = radians * (180 / Math.PI) + 90

    if (degrees < 0) degrees += 360

    return degrees
  }, [getCenterOfElement])

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current

    if (!card) return

    const rect = card.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const edge = getEdgeProximity(card, x, y)
    const angle = getCursorAngle(card, x, y)

    card.style.setProperty('--edge-proximity', `${(edge * 100).toFixed(3)}`)
    card.style.setProperty('--cursor-angle', `${angle.toFixed(3)}deg`)
  }, [getEdgeProximity, getCursorAngle])

  useEffect(() => {
    if (!animated || !cardRef.current) return

    const card = cardRef.current
    const angleStart = 110
    const angleEnd = 465
    const cleanups: Array<() => void> = []

    card.classList.add(styles.sweepActive)
    card.style.setProperty('--cursor-angle', `${angleStart}deg`)

    cleanups.push(
      animateValue({
        duration: 500,
        onUpdate: value => card.style.setProperty('--edge-proximity', value.toString()),
      })
    )
    cleanups.push(
      animateValue({
        ease: easeInCubic,
        duration: 1500,
        end: 50,
        onUpdate: value => {
          card.style.setProperty('--cursor-angle', `${(angleEnd - angleStart) * (value / 100) + angleStart}deg`)
        },
      })
    )
    cleanups.push(
      animateValue({
        ease: easeOutCubic,
        delay: 1500,
        duration: 2250,
        start: 50,
        end: 100,
        onUpdate: value => {
          card.style.setProperty('--cursor-angle', `${(angleEnd - angleStart) * (value / 100) + angleStart}deg`)
        },
      })
    )
    cleanups.push(
      animateValue({
        ease: easeInCubic,
        delay: 2500,
        duration: 1500,
        start: 100,
        end: 0,
        onUpdate: value => card.style.setProperty('--edge-proximity', value.toString()),
        onEnd: () => card.classList.remove(styles.sweepActive),
      })
    )

    return () => {
      cleanups.forEach(cleanup => cleanup())
      card.classList.remove(styles.sweepActive)
    }
  }, [animated])

  const style: GlowVars = {
    '--card-bg': backgroundColor,
    '--edge-sensitivity': edgeSensitivity,
    '--border-radius': `${borderRadius}px`,
    '--glow-padding': `${glowRadius}px`,
    '--cone-spread': coneSpread,
    '--fill-opacity': fillOpacity,
    ...buildGlowVars(glowColor, glowIntensity),
    ...buildGradientVars(colors),
  }

  return (
    <div
      ref={cardRef}
      onPointerMove={handlePointerMove}
      className={`${styles.card} ${className}`.trim()}
      style={style}
    >
      <span className={styles.edgeLight} aria-hidden="true" />
      <div className={styles.inner}>
        {children}
      </div>
    </div>
  )
}
