// @ts-nocheck
/**
 * Compact dot-style progress / navigation indicator for the report
 * slide deck. One dot per slide, the active one is enlarged and
 * filled. Clicking a dot jumps to that slide; hovering surfaces the
 * slide label as a tooltip so the affordance stays discoverable
 * even though the dots themselves are unlabeled.
 *
 * Designed to be overlaid on the slide stage (absolute positioned
 * by the parent) so it works equally well in the windowed viewer
 * and in fullscreen presentation mode.
 */
import React from 'react'

export default function SlideProgress({
  deck,
  index,
  onSelect,
  labels = {},
  className = '',
}) {
  if (!deck || deck.length <= 1) return null

  return (
    <div
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/30 backdrop-blur-sm ${className}`}
      role="tablist"
      aria-label="Slide navigation"
    >
      {deck.map((key, i) => {
        const isActive = i === index
        const label = labels[key] || key
        return (
          <button
            key={`${key}-${i}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={`Go to slide ${i + 1}: ${label}`}
            title={`${i + 1}. ${label}`}
            onClick={() => onSelect(i)}
            className={`group relative rounded-full transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
              isActive
                ? 'h-2.5 w-6 bg-white'
                : 'h-2 w-2 bg-white/40 hover:bg-white/70'
            }`}
          >
            <span className="sr-only">{`Slide ${i + 1}: ${label}`}</span>
          </button>
        )
      })}
    </div>
  )
}
