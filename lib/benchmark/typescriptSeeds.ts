import type { TypeScriptSeedBenchmark } from './types'

export const TYPESCRIPT_SEED_BENCHMARKS: TypeScriptSeedBenchmark[] = [
  {
    id: 'typed-event-routing',
    title: 'Typed event routing strategies',
    description: 'Compare switch narrowing, lookup tables, and reducer callbacks over a discriminated union event stream.',
    setup: `type ClickEvent = { kind: 'click'; x: number; y: number; pressure: number }
type ViewEvent = { kind: 'view'; durationMs: number; depth: number }
type PurchaseEvent = { kind: 'purchase'; cents: number; quantity: number }
type UserEvent = ClickEvent | ViewEvent | PurchaseEvent

const events: UserEvent[] = Array.from({ length: 2_000 }, (_, index): UserEvent => {
  if (index % 5 === 0) return { kind: 'purchase', cents: 299 + index, quantity: (index % 3) + 1 }
  if (index % 2 === 0) return { kind: 'click', x: index % 320, y: index % 180, pressure: (index % 10) / 10 }
  return { kind: 'view', durationMs: 120 + (index % 90), depth: index % 7 }
})

const weights: Record<UserEvent['kind'], number> = {
  click: 3,
  view: 1,
  purchase: 11,
}`,
    tests: [
      {
        title: 'Switch with union narrowing',
        code: `let score = 0

for (const event of events) {
  switch (event.kind) {
    case 'click':
      score += event.x + event.y + event.pressure * 10
      break
    case 'view':
      score += event.durationMs * event.depth
      break
    case 'purchase':
      score += event.cents * event.quantity
      break
  }
}

return score`,
      },
      {
        title: 'Record lookup plus common fields',
        code: `let score = 0

for (const event of events) {
  score += weights[event.kind]
  if (event.kind === 'purchase') score += event.cents * event.quantity
  else if (event.kind === 'view') score += event.durationMs * event.depth
  else score += event.x + event.y
}

return score`,
      },
      {
        title: 'Typed reduce callback',
        code: `return events.reduce((score: number, event: UserEvent) => {
  if (event.kind === 'purchase') return score + event.cents * event.quantity
  if (event.kind === 'view') return score + event.durationMs * event.depth
  return score + event.x + event.y + event.pressure * 10
}, 0)`,
      },
    ],
  },
  {
    id: 'generic-indexing',
    title: 'Generic indexing helpers',
    description: 'Compare generic helper styles for grouping typed records by a stable key.',
    setup: `type Product = {
  sku: string
  category: 'book' | 'tool' | 'game' | 'course'
  price: number
  stock: number
}

const products: Product[] = Array.from({ length: 1_500 }, (_, index) => ({
  sku: 'sku-' + index,
  category: (['book', 'tool', 'game', 'course'] as const)[index % 4],
  price: 10 + (index % 97),
  stock: index % 13,
}))

function bucketScore(item: Product): number {
  return item.price * (item.stock + 1)
}`,
    tests: [
      {
        title: 'Object buckets',
        code: `const totals: Record<Product['category'], number> = {
  book: 0,
  tool: 0,
  game: 0,
  course: 0,
}

for (const product of products) {
  totals[product.category] += bucketScore(product)
}

return totals.book + totals.tool + totals.game + totals.course`,
      },
      {
        title: 'Map buckets',
        code: `const totals = new Map<Product['category'], number>()

for (const product of products) {
  totals.set(product.category, (totals.get(product.category) || 0) + bucketScore(product))
}

return (totals.get('book') || 0) + (totals.get('tool') || 0) + (totals.get('game') || 0) + (totals.get('course') || 0)`,
      },
      {
        title: 'Generic group helper',
        code: `function sumBy<T, K extends string>(items: T[], keyOf: (item: T) => K, valueOf: (item: T) => number): Record<K, number> {
  const out = {} as Record<K, number>
  for (const item of items) {
    const key = keyOf(item)
    out[key] = (out[key] || 0) + valueOf(item)
  }
  return out
}

const totals = sumBy(products, product => product.category, bucketScore)
return totals.book + totals.tool + totals.game + totals.course`,
      },
    ],
  },
]

export function getTypeScriptSeedBenchmark(id: string = TYPESCRIPT_SEED_BENCHMARKS[0].id): TypeScriptSeedBenchmark {
  return TYPESCRIPT_SEED_BENCHMARKS.find(seed => seed.id === id) || TYPESCRIPT_SEED_BENCHMARKS[0]
}
