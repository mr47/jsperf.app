import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { codeLanguageClass, highlightSanitizedCode } from '../utils/hljs'
import type { JitSourceMapRange, OptimizedBlock } from '../utils/jitSourceMap'

export default function JitSourceMapViewer({
  blocks,
  activeBlockIndex,
  onActiveBlockIndexChange,
}: {
  blocks: OptimizedBlock[]
  activeBlockIndex: number
  onActiveBlockIndexChange: (index: number) => void
}) {
  const activeBlock = blocks[activeBlockIndex] || blocks[0] || null
  const [selectedRangeId, setSelectedRangeId] = useState<string | null>(null)
  const selectedRange = useMemo(() => {
    if (!activeBlock?.mappedRanges.length) return null
    return activeBlock.mappedRanges.find(range => range.id === selectedRangeId) || activeBlock.mappedRanges[0]
  }, [activeBlock, selectedRangeId])

  if (!activeBlock) return null

  const hasPreciseMap = activeBlock.hasPreciseSourceMap && activeBlock.mappedRanges.length > 0

  return (
    <section className="border-b border-border/70 bg-background">
      <div className="flex flex-col gap-3 border-b border-border/70 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-semibold tracking-tight">JIT source map</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasPreciseMap
              ? `${activeBlock.mappedRanges.length} source ${activeBlock.mappedRanges.length === 1 ? 'span' : 'spans'} linked to generated assembly.`
              : 'No source-position table in this artifact. Showing source beside the full optimized function.'}
          </p>
        </div>
        {blocks.length > 1 && (
          <div className="inline-flex w-fit rounded-lg border border-border bg-muted/40 p-1">
            {blocks.map((block, index) => (
              <Button
                key={block.id}
                type="button"
                variant={index === activeBlockIndex ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 rounded-md px-3 text-xs"
                onClick={() => {
                  onActiveBlockIndexChange(index)
                  setSelectedRangeId(null)
                }}
              >
                Block {index + 1}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="grid xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="min-w-0 border-b border-border xl:border-b-0 xl:border-r">
          <PaneHeader
            title="Source"
            detail={activeBlock.name || 'jsperfUserBenchmark'}
            meta={activeBlock.kind || undefined}
          />
          <SourceCode source={activeBlock.source} selectedRange={selectedRange} />
          {hasPreciseMap && (
            <MappedSpanList
              ranges={activeBlock.mappedRanges}
              selectedRange={selectedRange}
              onSelect={setSelectedRangeId}
            />
          )}
        </div>

        <div className="min-w-0">
          <PaneHeader
            title="Assembly"
            detail={hasPreciseMap && selectedRange ? `pc ${formatPcRange(selectedRange)}` : 'optimized function'}
            meta={assemblyMeta(activeBlock, selectedRange)}
          />
          {hasPreciseMap && selectedRange && (
            <div className="border-b border-border bg-muted/20 px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Selected source</div>
              <div className="mt-1 truncate font-mono text-sm text-foreground">{selectedRange.sourceSnippet}</div>
            </div>
          )}
          <pre className="m-0 max-h-[64vh] overflow-auto bg-[#f6f8fa] p-4 text-xs leading-relaxed dark:bg-[#0d1117] sm:text-sm">
            <code
              className={`${codeLanguageClass('x86asm', selectedRange?.instructions || activeBlock.instructionBody || activeBlock.optimizedBody)} block whitespace-pre`}
              dangerouslySetInnerHTML={{
                __html: highlightSanitizedCode(selectedRange?.instructions || activeBlock.instructionBody || activeBlock.optimizedBody, 'x86asm'),
              }}
            />
          </pre>
        </div>
      </div>
    </section>
  )
}

function PaneHeader({ title, detail, meta }: { title: string; detail: string; meta?: string }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="truncate font-mono text-xs text-muted-foreground">{detail}</div>
      </div>
      {meta && (
        <div className="shrink-0 rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground">
          {meta}
        </div>
      )}
    </div>
  )
}

function MappedSpanList({
  ranges,
  selectedRange,
  onSelect,
}: {
  ranges: JitSourceMapRange[]
  selectedRange: JitSourceMapRange | null
  onSelect: (id: string) => void
}) {
  return (
    <div className="border-t border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="text-xs font-medium text-foreground">Mapped spans</div>
        <div className="text-[11px] text-muted-foreground">source {'->'} pc ranges</div>
      </div>
      <div className="max-h-52 overflow-auto">
        {ranges.map((range, index) => (
          <button
            key={range.id}
            type="button"
            className={`grid w-full grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 px-4 py-2 text-left transition-colors last:border-b-0 ${
              range.id === selectedRange?.id
                ? 'bg-sky-500/10'
                : 'bg-background hover:bg-muted/40'
            }`}
            onClick={() => onSelect(range.id)}
            title={range.sourceSnippet}
          >
            <span className="font-mono text-xs text-muted-foreground">#{index + 1}</span>
            <span className="truncate font-mono text-xs text-foreground">{range.sourceSnippet || '(source)'}</span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {range.mappedSourcePosition} {'->'} {formatPcRangeSummary(range)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function SourceCode({ source, selectedRange }: { source: string; selectedRange: JitSourceMapRange | null }) {
  const lines = splitSourceLines(source)
  return (
    <pre className="m-0 max-h-[44vh] overflow-auto bg-[#f6f8fa] p-0 text-xs leading-relaxed dark:bg-[#0d1117] sm:text-sm">
      <code className="block min-w-max py-4">
        {lines.map((line, index) => (
          <span key={`${line.start}:${index}`} className="block px-4 font-mono">
            <span className="mr-4 inline-block w-7 select-none text-right text-muted-foreground/60">
              {index + 1}
            </span>
            <SourceLine line={line} selectedRange={selectedRange} />
            {'\n'}
          </span>
        ))}
      </code>
    </pre>
  )
}

function SourceLine({
  line,
  selectedRange,
}: {
  line: { text: string; start: number; end: number }
  selectedRange: JitSourceMapRange | null
}) {
  if (!selectedRange || selectedRange.sourceEnd <= line.start || selectedRange.sourceStart >= line.end) {
    return <span>{line.text || ' '}</span>
  }

  const highlightStart = Math.max(selectedRange.sourceStart, line.start) - line.start
  const highlightEnd = Math.min(selectedRange.sourceEnd, line.end) - line.start
  const before = line.text.slice(0, highlightStart)
  const selected = line.text.slice(highlightStart, highlightEnd) || ' '
  const after = line.text.slice(highlightEnd)

  return (
    <>
      <span>{before}</span>
      <mark className="rounded-sm bg-sky-400/20 px-0.5 text-foreground ring-1 ring-sky-400/30">
        {selected}
      </mark>
      <span>{after}</span>
    </>
  )
}

function splitSourceLines(source: string) {
  const lines = source.split('\n')
  let offset = 0
  return lines.map((text) => {
    const line = { text, start: offset, end: offset + text.length }
    offset += text.length + 1
    return line
  })
}

function formatPcRange(range: JitSourceMapRange) {
  return `${range.pcOffsetHex}${range.endPcOffsetHex ? `-${range.endPcOffsetHex}` : '+'}`
}

function formatPcRangeSummary(range: JitSourceMapRange) {
  if (range.pcRanges.length <= 1) return formatPcRange(range)
  return `${range.pcRanges.length} ranges`
}

function assemblyMeta(block: OptimizedBlock, selectedRange: JitSourceMapRange | null) {
  const parts = [
    selectedRange ? `${selectedRange.instructionCount} ins` : block.instructionSize ? `${block.instructionSize} bytes` : null,
    block.compiler,
    block.optimizationId ? `opt ${block.optimizationId}` : null,
  ].filter(Boolean)
  return parts.join(' / ') || undefined
}
