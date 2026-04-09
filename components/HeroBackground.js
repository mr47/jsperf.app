import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { AsciiEffect } from 'three-stdlib'
import { useRef, useEffect, useState, useMemo, useLayoutEffect } from 'react'
import { useTheme } from 'next-themes'

// Custom AsciiRenderer to fix a bug in drei where setSize is called after the first render,
// causing a crash in getImageData because width/height are undefined on the first frame.
function CustomAsciiRenderer({
  renderIndex = 1,
  bgColor = 'black',
  fgColor = 'white',
  characters = ' .:-+*=%@#',
  invert = true,
  color = false,
  resolution = 0.15
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
  const lastRenderTime = useRef(0)

  // Set size whenever it changes, but only if valid
  useEffect(() => {
    if (size.width > 0 && size.height > 0) {
      effect.setSize(Math.round(size.width), Math.round(size.height))
      sizeSet.current = true
    }
  }, [effect, size])

  useFrame((state) => {
    // Completely prevent rendering if size is missing or invalid
    if (!size.width || !size.height || size.width <= 0 || size.height <= 0) return

    if (!sizeSet.current) {
      effect.setSize(Math.round(size.width), Math.round(size.height))
      sizeSet.current = true
    }
    
    if (sizeSet.current) {
      // Throttle the ASCII rendering to ~30 FPS to massively save CPU/improve performance
      // We use performance.now() instead of state.clock to avoid THREE.Clock deprecation warnings
      const now = performance.now() / 1000
      if (now - lastRenderTime.current >= 1 / 30) {
        try {
          effect.render(scene, camera)
        } catch (e) {
          // fail silently on canvas read errors rather than crashing the loop
        }
        lastRenderTime.current = now
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
      {/* We use a beautifully proportioned TorusKnot to catch the lighting dynamically */}
      {/* Decreased the segment counts significantly from 150/32 to 64/16 to boost FPS */}
      <torusKnotGeometry args={[10, 2.5, 64, 16, 2, 3]} />
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
  
  useEffect(() => {
    setMounted(true)
    
    // Check for mobile screens to disable heavy 3D rendering
    const mediaQuery = window.matchMedia('(max-width: 768px)')
    setIsMobile(mediaQuery.matches)
    
    const handler = (e) => setIsMobile(e.matches)
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [])

  if (!mounted) return null

  // Ensure high contrast based on theme if not using color={true}
  const fgColor = resolvedTheme === 'dark' ? '#818cf8' : '#4338ca' 

  return (
    <div className="absolute inset-0 -z-10 h-full w-full overflow-hidden opacity-90 dark:opacity-100 pointer-events-none flex items-center justify-center" style={{ maskImage: "radial-gradient(ellipse at center, black, transparent 75%)", WebkitMaskImage: "radial-gradient(ellipse at center, black, transparent 75%)" }}>
      {isMobile ? (
        // Ultra-lightweight pure CSS fallback for mobile to save battery and ensure 60fps scrolling
        <div className="relative w-full h-full opacity-60">
          <div className={`absolute top-[20%] left-[10%] w-64 h-64 rounded-full blur-[100px] ${resolvedTheme === 'dark' ? 'bg-[#00ffff]/40' : 'bg-[#0ea5e9]/40'}`} />
          <div className={`absolute bottom-[20%] right-[10%] w-64 h-64 rounded-full blur-[100px] ${resolvedTheme === 'dark' ? 'bg-[#ff00ff]/40' : 'bg-[#d946ef]/40'}`} />
          <div className={`absolute top-[40%] left-[50%] w-48 h-48 -translate-x-1/2 rounded-full blur-[80px] ${resolvedTheme === 'dark' ? 'bg-[#8a2be2]/40' : 'bg-transparent'}`} />
        </div>
      ) : (
        <Canvas 
          camera={{ position: [0, 0, 30] }}
          onCreated={({ gl }) => {
            // Hide the original WebGL canvas immediately upon creation so the raw mesh never flashes
            gl.domElement.style.opacity = '0'
          }}
        >
          {/* Soft ambient base */}
          <ambientLight intensity={0.3} />
          
          {/* Strong, colorful directional lights to give a 3D light effect to the ASCII */}
          {/* Using electric cyan, hot pink, and deep purple for a dramatic cyberpunk 'wow' effect */}
          <directionalLight position={[10, 10, 10]} color={resolvedTheme === 'dark' ? "#00ffff" : "#0ea5e9"} intensity={5} />  
          <directionalLight position={[-10, -10, 10]} color={resolvedTheme === 'dark' ? "#ff00ff" : "#d946ef"} intensity={5} /> 
          <directionalLight position={[0, 0, -10]} color={resolvedTheme === 'dark' ? "#8a2be2" : "#ffffff"} intensity={2} />
          
          <CoolShape />
          
          <CustomAsciiRenderer 
            fgColor={fgColor} 
            bgColor="transparent" 
            characters=" .:-+*=%@#" 
            invert={resolvedTheme === 'light'} 
            color={true} // Setting this to true maps the actual 3D scene lighting colors to the ASCII characters!
            resolution={0.15} // Lower resolution is MUCH better for FPS, 0.15 is the sweet spot
          />
        </Canvas>
      )}
    </div>
  )
}