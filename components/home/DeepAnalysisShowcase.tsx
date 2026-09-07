import Link from 'next/link'
import Image from 'next/image'
import type { ReactNode } from 'react'
import { ArrowRight, Cpu, Flame, Layers, Microscope, Presentation } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { benchmarkPath } from '../../lib/benchmark/paths'
import { HOME_DEMO_SLUG } from '../../lib/homeShared'

const EXAMPLE_BENCHMARK = benchmarkPath(HOME_DEMO_SLUG)
const EXAMPLE_JIT = '/jit/f727efdaf587c11d81a7f3ef'
const EXAMPLE_REPORT = '/r/rvtu7jfm'

type Feature = {
  value: string
  tab: string
  icon: LucideIcon
  title: string
  body: string
  points: string[]
  cta: { href: string; label: string }
  preview: ReactNode
}

function PreviewFrame({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-xl border border-border/70 bg-slate-950 text-slate-200 shadow-lg ${className}`}>
      <div className="flex items-center gap-1.5 border-b border-white/10 bg-slate-900 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="ml-3 truncate font-mono text-[11px] text-slate-400">{label}</span>
      </div>
      {children}
    </div>
  )
}

function Bar({ label, value, max, accent = false }: { label: string; value: number; max: number; accent?: boolean }) {
  const width = Math.max(4, Math.round((value / max) * 100))
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-[11px]">
        <span className="truncate text-slate-300">{label}</span>
        <span className="shrink-0 font-mono tabular-nums text-slate-400">{value.toLocaleString('en-US')} ops/s</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${accent ? 'bg-violet-400' : 'bg-slate-500'}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

const FEATURES: Feature[] = [
  {
    value: 'engines',
    tab: 'Engines',
    icon: Microscope,
    title: 'A deterministic baseline next to a real JIT',
    body: 'Browser numbers move with every run. Deep Analysis executes your cases in QuickJS compiled to WebAssembly for a variance-free baseline, then in V8 inside an isolated Firecracker microVM to capture inline caching, optimisation and GC effects.',
    points: ['QuickJS memory-limit sweeps show how each case degrades under pressure', 'V8 runs single-core and canonical, so cases stay comparable across sessions', 'The prediction model reports JIT amplification per case'],
    cta: { href: EXAMPLE_BENCHMARK, label: 'Open the example benchmark' },
    preview: (
      <PreviewFrame label="Deep Analysis · engines">
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <div className="space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">QuickJS · baseline</p>
            <Bar label="Indexed order scoring" value={2140} max={2140} />
            <Bar label="Polymorphic normalization" value={1370} max={2140} />
          </div>
          <div className="space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">V8 · microVM</p>
            <Bar label="Indexed order scoring" value={48900} max={48900} accent />
            <Bar label="Polymorphic normalization" value={19600} max={48900} accent />
          </div>
        </div>
        <div className="border-t border-white/10 bg-slate-900/80 px-5 py-3 text-[11px] text-slate-400">
          JIT amplification <span className="font-mono text-slate-200">22.8×</span> vs <span className="font-mono text-slate-200">14.3×</span> — the monomorphic path benefits far more from optimisation. Illustrative numbers.
        </div>
      </PreviewFrame>
    ),
  },
  {
    value: 'runtimes',
    tab: 'Runtimes',
    icon: Layers,
    title: 'The same cases across Node, Deno and Bun',
    body: 'Server-side workers run each benchmark in the runtimes you pick, at the versions you pick. TypeScript stays native on Deno and Bun and is compiled where the engine needs JavaScript.',
    points: ['Choose runtime versions per analysis', 'Results are stored with the benchmark, so the comparison is shareable', 'A compatibility matrix flags cases that only win on one runtime'],
    cta: { href: '/javascript-runtime-benchmark', label: 'How runtime comparisons work' },
    preview: (
      <PreviewFrame label="Deep Analysis · runtimes">
        <div className="space-y-4 p-5">
          {[
            ['Node 24', 51200, true],
            ['Bun 1.3', 47800, false],
            ['Deno 2.4', 44100, false],
          ].map(([name, value, accent]) => (
            <Bar key={String(name)} label={String(name)} value={Number(value)} max={51200} accent={Boolean(accent)} />
          ))}
        </div>
        <div className="border-t border-white/10 bg-slate-900/80 px-5 py-3 text-[11px] text-slate-400">Indexed order scoring, ops/sec per runtime. Illustrative numbers.</div>
      </PreviewFrame>
    ),
  },
  {
    value: 'jit',
    tab: 'JIT viewer',
    icon: Flame,
    title: 'Read the optimised code Node actually ran',
    body: 'Capture V8 optimised-code output during a Node run and open it in a viewer that maps each optimised block back to the benchmark line that produced it.',
    points: ['Source-linked optimised blocks and searchable assembly', 'Artifacts are stored once and shared by URL', 'Pair JIT evidence with the ops/sec it explains'],
    cta: { href: EXAMPLE_JIT, label: 'View a sample JIT artifact' },
    preview: (
      <PreviewFrame label="JIT viewer · Node.js V8">
        <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="space-y-2">
            {[
              ['normalizePolymorphic', 'hot path'],
              ['routingBySku.get', 'inline cache'],
              ['total += order.quantity', 'TurboFan'],
            ].map(([label, meta]) => (
              <div key={label} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className="truncate font-mono text-xs text-slate-100">{label}</div>
                <div className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">{meta}</div>
              </div>
            ))}
          </div>
          <pre className="min-w-0 overflow-x-auto rounded-lg border border-white/10 bg-black/30 p-4 text-xs leading-relaxed text-slate-300"><code>{`const route = routingBySku.get(order.sku) ?? 0
total += order.quantity * route

--- Optimized code ---
0x...  movq rdx,[rbp-0x38]
0x...  cmpq [rdx+0x17],rax
0x...  jnz  deopt_inline_cache`}</code></pre>
        </div>
      </PreviewFrame>
    ),
  },
  {
    value: 'cpu',
    tab: 'CPU profile',
    icon: Cpu,
    title: 'A real .cpuprofile from the benchmark loop',
    body: 'The profiler starts around the measured Node run so setup and teardown stay out of the sample window. Open it on jsPerf, download it for Chrome DevTools, or inspect flame graphs in CPUpro.',
    points: ['Hot functions and call frames for each case', 'Profiles are stored separately and referenced from results', 'Works best with realistic workloads like the commerce example'],
    cta: { href: EXAMPLE_BENCHMARK, label: 'Open a benchmark with a profile' },
    preview: (
      <PreviewFrame label="CPUpro report · Node.js profile">
        <Image
          src="/cpu-profile-report.png"
          alt="CPUpro report showing Node.js profiling time, samples, call frames and flame graph controls"
          width={1440}
          height={1100}
          className="max-h-[400px] w-full object-cover object-top"
        />
      </PreviewFrame>
    ),
  },
  {
    value: 'reports',
    tab: 'Reports',
    icon: Presentation,
    title: 'Turn a run into a slide deck',
    body: 'Generate a presentation from any analysed benchmark: methodology, numbers, JIT amplification and a recommendation. Present it fullscreen, share one immutable URL, or print to PDF.',
    points: ['Keyboard navigation and fullscreen presenter mode', 'Light-theme print layout for handouts', 'Available to donors'],
    cta: { href: EXAMPLE_REPORT, label: 'See an example report' },
    preview: (
      <PreviewFrame label="jsperf.net/r/rvtu7jfm">
        <div className="flex aspect-[16/10] flex-col bg-gradient-to-br from-slate-900 via-slate-950 to-violet-950/40 p-6 sm:p-8">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-slate-400">
            <span>Slide 4 of 7 — Recommendation</span>
            <span className="font-mono normal-case tracking-normal">jsperf.net</span>
          </div>
          <div className="mt-6 flex-1">
            <h3 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
              <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">for…of with Map.entries()</span> is the winner
            </h3>
            <p className="mt-2 text-sm text-slate-300">Outperforms <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-xs">forEach()</code> by <strong className="text-white">2.3×</strong> under canonical V8 with stable JIT amplification.</p>
            <div className="mt-5 grid grid-cols-3 gap-2">
              {[['QuickJS', '412k'], ['V8', '9.4M'], ['JIT amp.', '22.8×']].map(([label, value], index) => (
                <div key={label} className={`rounded-md border p-2 ${index === 1 ? 'border-violet-400/50 bg-violet-500/10' : 'border-white/10 bg-white/[0.03]'}`}>
                  <p className="text-[9px] uppercase tracking-wider text-slate-400">{label}</p>
                  <p className="text-sm font-bold tabular-nums text-white">{value}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-center gap-1.5 pt-4">
            {Array.from({ length: 7 }, (_, index) => (
              <span key={index} className={`h-1.5 rounded-full ${index === 3 ? 'w-5 bg-violet-400' : 'w-1.5 bg-white/20'}`} />
            ))}
          </div>
        </div>
      </PreviewFrame>
    ),
  },
]

export default function DeepAnalysisShowcase() {
  return (
    <section id="deep-analysis" aria-labelledby="deep-heading" className="border-t border-border/60 py-16 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">Deep Analysis</p>
        <h2 id="deep-heading" className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">When browser numbers aren't enough</h2>
        <p className="mt-3 text-lg text-muted-foreground">
          One click sends the same cases to controlled server-side environments and brings back reproducible results, engine internals and a shareable report.
        </p>
      </div>

      <Tabs defaultValue={FEATURES[0].value} className="mt-10">
        <div className="flex justify-center">
          <TabsList className="h-auto flex-wrap justify-center gap-1 bg-muted/70 p-1">
            {FEATURES.map(({ value, tab, icon: Icon }) => (
              <TabsTrigger key={value} value={value} className="h-9 flex-none px-3">
                <Icon aria-hidden="true" />
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {FEATURES.map(({ value, title, body, points, cta, preview }) => (
          <TabsContent key={value} value={value} className="mt-8">
            {/* Fixed minimum height so switching tabs doesn't shift the page below. */}
            <div className="grid items-start gap-10 lg:min-h-[460px] lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
              <div className="space-y-5">
                <h3 className="text-2xl font-bold tracking-tight">{title}</h3>
                <p className="leading-relaxed text-muted-foreground">{body}</p>
                <ul className="space-y-2 text-sm">
                  {points.map((point) => (
                    <li key={point} className="flex items-start gap-2.5">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" aria-hidden="true" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
                <Button asChild variant="outline" className="rounded-full">
                  <Link href={cta.href}>
                    {cta.label}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
              </div>
              <div className="min-w-0">{preview}</div>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </section>
  )
}
