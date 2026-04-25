import React, { useEffect, useRef, useState } from 'react'
import { ResponsiveContainer } from 'recharts'

export default function SafeResponsiveContainer({
  children,
  className = '',
  style,
  minWidth = 0,
  minHeight = 0,
  ...props
}) {
  const ref = useRef(null)
  const [hasSize, setHasSize] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined

    const updateSize = () => {
      const rect = node.getBoundingClientRect()
      setHasSize(rect.width > 0 && rect.height > 0)
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(node)

    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className={className} style={style}>
      {hasSize && (
        <ResponsiveContainer
          width="100%"
          height="100%"
          minWidth={minWidth}
          minHeight={minHeight}
          {...props}
        >
          {children}
        </ResponsiveContainer>
      )}
    </div>
  )
}
