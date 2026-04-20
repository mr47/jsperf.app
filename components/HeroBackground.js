import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { AsciiEffect } from 'three-stdlib'
import { useRef, useEffect, useState, useMemo, useLayoutEffect, useCallback } from 'react'
import { useTheme } from 'next-themes'

const TARGET_FPS = 15

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

function CustomAsciiRenderer({
  renderIndex = 1,
  bgColor = 'black',
  fgColor = 'white',
  characters = ' .:-+*=%@#',
  invert = true,
  color = false,
  resolution = 0.12
}) {
  const { size, gl, scene, camera } = useThree()

  const effect = useMemo(() => {
    const effect = new AsciiEffect(gl, characters, { invert, color, resolution })
    effect.domElement.style.position = 'absolute'
    effect.domElement.style.top = '0px'
    effect.domElement.style.left = '0px'
    effect.domElement.style.pointerEvents = 'none'
    return effect
  }, [characters, invert, color, resolution, gl])

  useLayoutEffect(() => {
    if (!color) {
      effect.domElement.style.color = fgColor
    }
    effect.domElement.style.backgroundColor = bgColor
  }, [fgColor, bgColor, effect, color])

  useEffect(() => {
    gl.domElement.style.opacity = '0'
    gl.domElement.parentNode.appendChild(effect.domElement)
    return () => {
      gl.domElement.style.opacity = '1'
      if (effect.domElement.parentNode) {
        effect.domElement.parentNode.removeChild(effect.domElement)
      }
    }
  }, [effect, gl])

  const sizeSet = useRef(false)

  useEffect(() => {
    if (size.width > 0 && size.height > 0) {
      effect.setSize(Math.round(size.width), Math.round(size.height))
      sizeSet.current = true
    }
  }, [effect, size])

  useFrame(() => {
    if (!size.width || !size.height || size.width <= 0 || size.height <= 0) return

    if (!sizeSet.current) {
      effect.setSize(Math.round(size.width), Math.round(size.height))
      sizeSet.current = true
    }

    if (sizeSet.current) {
      try {
        effect.render(scene, camera)
      } catch (e) {
        // fail silently on canvas read errors
      }
    }
  }, renderIndex)

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
  const [visible, setVisible] = useState(true)
  const containerRef = useRef(null)
  
  useEffect(() => {
    setMounted(true)
    
    const mediaQuery = window.matchMedia('(max-width: 768px)')
    setIsMobile(mediaQuery.matches)
    
    const handler = (e) => setIsMobile(e.matches)
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
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

  const fgColor = resolvedTheme === 'dark' ? '#818cf8' : '#4338ca' 

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 -z-10 h-full w-full overflow-hidden opacity-90 dark:opacity-100 pointer-events-none flex items-center justify-center"
      style={{
        maskImage: "radial-gradient(ellipse at center, black, transparent 75%)",
        WebkitMaskImage: "radial-gradient(ellipse at center, black, transparent 75%)",
        // Promote this subtree to its own GPU compositor layer so the
        // 15Hz ASCII repaints don't dirty the cards/modal/header above.
        // The four hints below are intentionally redundant: `contain`
        // scopes paint, `isolation` creates a stacking + backdrop root,
        // `will-change` requests a layer, and the translateZ(0) forces
        // it on browsers that defer `will-change` until first animation.
        contain: 'content',
        isolation: 'isolate',
        willChange: 'transform',
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden',
      }}
    >
      {isMobile ? (
        <div className="relative w-full h-full opacity-60">
          <div className={`absolute top-[20%] left-[10%] w-64 h-64 rounded-full blur-[100px] ${resolvedTheme === 'dark' ? 'bg-[#00ffff]/40' : 'bg-[#0ea5e9]/40'}`} />
          <div className={`absolute bottom-[20%] right-[10%] w-64 h-64 rounded-full blur-[100px] ${resolvedTheme === 'dark' ? 'bg-[#ff00ff]/40' : 'bg-[#d946ef]/40'}`} />
          <div className={`absolute top-[40%] left-[50%] w-48 h-48 -translate-x-1/2 rounded-full blur-[80px] ${resolvedTheme === 'dark' ? 'bg-[#8a2be2]/40' : 'bg-transparent'}`} />
        </div>
      ) : (
        <Canvas
          frameloop="demand"
          dpr={0.15}
          camera={{ position: [0, 0, 30] }}
          gl={{
            powerPreference: 'low-power',
            antialias: false,
            stencil: false,
            depth: true,
            alpha: true,
            preserveDrawingBuffer: false,
          }}
          onCreated={({ gl }) => {
            gl.domElement.style.opacity = '0'
          }}
        >
          <FrameThrottler paused={!visible} />

          <ambientLight intensity={0.3} />
          <directionalLight position={[10, 10, 10]} color={resolvedTheme === 'dark' ? "#00ffff" : "#0ea5e9"} intensity={5} />
          <directionalLight position={[-10, -10, 10]} color={resolvedTheme === 'dark' ? "#ff00ff" : "#d946ef"} intensity={5} />
          <directionalLight position={[0, 0, -10]} color={resolvedTheme === 'dark' ? "#8a2be2" : "#ffffff"} intensity={2} />

          <CoolShape />

          <CustomAsciiRenderer
            fgColor={fgColor}
            bgColor="transparent"
            characters=" .:-+*=%@#"
            invert={resolvedTheme === 'light'}
            color={true}
            resolution={0.12}
          />
        </Canvas>
      )}
    </div>
  )
}