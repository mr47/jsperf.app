import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { codeLanguageClass, highlightSanitizedCode } from '../utils/hljs'
import type { JitSourceMapRange, OptimizedBlock } from '../utils/jitSourceMap'

type AssemblyViewMode = 'highlight' | 'filter'

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
  const [assemblyViewMode, setAssemblyViewMode] = useState<AssemblyViewMode>('highlight')
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

      <div className="grid min-h-[72vh] xl:h-[72vh] xl:min-h-[680px] xl:grid-cols-[minmax(360px,0.9fr)_minmax(520px,1.1fr)]">
        <div className="flex min-h-0 min-w-0 flex-col border-b border-border xl:border-b-0 xl:border-r">
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

        <div className="flex min-h-0 min-w-0 flex-col">
          <PaneHeader
            title="Assembly"
            detail={hasPreciseMap && selectedRange ? formatAssemblyDetail(selectedRange, assemblyViewMode) : 'optimized function'}
            meta={assemblyMeta(activeBlock, selectedRange)}
          />
          {hasPreciseMap && selectedRange && (
            <div className="flex flex-col gap-3 border-b border-border bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Selected source</div>
                <div className="mt-1 truncate font-mono text-sm text-foreground">{selectedRange.sourceSnippet}</div>
              </div>
              <AssemblyModeToggle value={assemblyViewMode} onChange={setAssemblyViewMode} />
            </div>
          )}
          <AssemblyCode block={activeBlock} selectedRange={selectedRange} viewMode={assemblyViewMode} />
        </div>
      </div>
    </section>
  )
}

function AssemblyModeToggle({
  value,
  onChange,
}: {
  value: AssemblyViewMode
  onChange: (value: AssemblyViewMode) => void
}) {
  return (
    <div className="inline-flex w-fit rounded-lg border border-border bg-background p-1">
      {(['highlight', 'filter'] as const).map(mode => (
        <Button
          key={mode}
          type="button"
          variant={value === mode ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 rounded-md px-3 text-xs capitalize"
          onMouseDown={event => event.preventDefault()}
          onClick={() => onChange(mode)}
        >
          {mode}
        </Button>
      ))}
    </div>
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
    <div className="flex min-h-0 flex-1 flex-col border-t border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="text-xs font-medium text-foreground">Source regions</div>
        <div className="text-[11px] text-muted-foreground">linked assembly</div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {ranges.map((range, index) => (
          <button
            key={range.id}
            type="button"
            className={`grid w-full grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 px-4 py-2.5 text-left transition-colors last:border-b-0 ${
              range.id === selectedRange?.id
                ? 'bg-sky-500/10'
                : 'bg-background hover:bg-muted/40'
            }`}
            onClick={() => onSelect(range.id)}
            onMouseDown={event => event.preventDefault()}
            title={range.sourceSnippet}
          >
            <span className="font-mono text-xs text-muted-foreground">#{index + 1}</span>
            <span className="min-w-0">
              <span className="block text-xs font-medium text-foreground">
                {range.astMatch?.label || 'source region'}
              </span>
              <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                {range.sourceSnippet || '(source)'}
              </span>
            </span>
            <span className="text-right font-mono text-[11px] text-muted-foreground">
              {range.instructionCount} ins
              <span className="block">{formatPcRangeSummary(range)}</span>
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
    <pre className="m-0 min-h-[360px] flex-[0_0_62%] overflow-auto bg-[#f6f8fa] p-0 text-xs leading-relaxed dark:bg-[#0d1117] sm:text-sm">
      <code className={`${codeLanguageClass('javascript', source)} block min-w-max py-4`}>
        {lines.map((line, index) => {
          const selected = isSelectedSourceLine(line, selectedRange)
          return (
            <span
              key={`${line.start}:${index}`}
              className={`relative block px-5 font-mono ${
                selected
                  ? 'bg-sky-500/10 before:absolute before:bottom-1 before:left-0 before:top-1 before:w-1 before:rounded-r before:bg-sky-400'
                  : ''
              }`}
            >
              <span className={`mr-4 inline-block w-7 select-none text-right ${
                selected ? 'text-sky-500' : 'text-muted-foreground/60'
              }`}>
                {index + 1}
              </span>
              <SourceLine line={line} />
              {'\n'}
            </span>
          )
        })}
      </code>
    </pre>
  )
}

function AssemblyCode({
  block,
  selectedRange,
  viewMode,
}: {
  block: OptimizedBlock
  selectedRange: JitSourceMapRange | null
  viewMode: AssemblyViewMode
}) {
  const allLines = block.instructions.length > 0
    ? block.instructions
    : splitPlainAssembly(block.instructionBody || block.optimizedBody)
  const lines = viewMode === 'filter' && selectedRange
    ? allLines.filter(line => isSelectedAssemblyLine(line.pcOffset, selectedRange))
    : allLines

  return (
    <pre className="m-0 min-h-0 flex-1 overflow-auto bg-[#f6f8fa] p-0 text-xs leading-relaxed dark:bg-[#0d1117] sm:text-sm">
      <code className={`${codeLanguageClass('x86asm', block.instructionBody || block.optimizedBody)} block min-w-max whitespace-pre py-5`}>
        {lines.map((line, index) => {
          const selected = viewMode === 'highlight' && isSelectedAssemblyLine(line.pcOffset, selectedRange)
          return (
            <span
              key={`${line.pcOffsetHex || 'line'}:${index}`}
              className={`relative block px-5 font-mono ${
                selected
                  ? 'bg-sky-500/10 before:absolute before:bottom-1 before:left-0 before:top-1 before:w-1 before:rounded-r before:bg-sky-400'
                  : ''
              }`}
            >
              <HighlightedAssemblyPart code={line.text || ' '} />
              {'\n'}
            </span>
          )
        })}
      </code>
    </pre>
  )
}

function isSelectedAssemblyLine(pcOffset: number | null, selectedRange: JitSourceMapRange | null) {
  if (pcOffset == null || !selectedRange) return false
  return selectedRange.pcRanges.some(range =>
    pcOffset >= range.start && (range.end == null ? pcOffset >= range.start : pcOffset < range.end)
  )
}

function HighlightedAssemblyPart({ code }: { code: string }) {
  if (!code) return null
  return (
    <span
      dangerouslySetInnerHTML={{
        __html: highlightSanitizedCode(code, 'x86asm'),
      }}
    />
  )
}

function SourceLine({
  line,
}: {
  line: { text: string; start: number; end: number }
}) {
  return <HighlightedSourcePart code={line.text || ' '} />
}

function isSelectedSourceLine(
  line: { text: string; start: number; end: number },
  selectedRange: JitSourceMapRange | null,
) {
  if (!selectedRange) return false
  const lineEnd = line.end === line.start ? line.end + 1 : line.end
  return selectedRange.sourceStart < lineEnd && selectedRange.sourceEnd > line.start
}

function HighlightedSourcePart({ code }: { code: string }) {
  if (!code) return null
  return (
    <span
      dangerouslySetInnerHTML={{
        __html: highlightSanitizedCode(code, 'javascript'),
      }}
    />
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

function splitPlainAssembly(source: string) {
  return source.split('\n').map(text => ({
    text,
    address: null,
    pcOffset: null,
    pcOffsetHex: null,
  }))
}

function formatPcRange(range: JitSourceMapRange) {
  return `${range.pcOffsetHex}${range.endPcOffsetHex ? `-${range.endPcOffsetHex}` : '+'}`
}

function formatPcRangeSummary(range: JitSourceMapRange) {
  if (range.pcRanges.length <= 1) return formatPcRange(range)
  return `${range.pcRanges.length} ranges`
}

function formatAssemblyDetail(range: JitSourceMapRange, viewMode: AssemblyViewMode) {
  const prefix = viewMode === 'filter' ? 'filtered' : 'highlighting'
  return range.pcRanges.length <= 1 ? `${prefix} pc ${formatPcRange(range)}` : `${prefix} ${range.pcRanges.length} pc ranges`
}

function assemblyMeta(block: OptimizedBlock, selectedRange: JitSourceMapRange | null) {
  const parts = [
    selectedRange ? `${selectedRange.instructionCount} ins` : block.instructionSize ? `${block.instructionSize} bytes` : null,
    block.compiler,
    block.optimizationId ? `opt ${block.optimizationId}` : null,
  ].filter(Boolean)
  return parts.join(' / ') || undefined
}
