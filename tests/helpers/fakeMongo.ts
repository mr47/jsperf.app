/**
 * Minimal in-memory stand-in for the MongoDB collection surface used by
 * lib/users.ts, lib/errorLog.ts and the admin API routes. Supports the
 * query operators those modules actually use ($in, $ne, $gt, $gte, $type,
 * dotted paths) and the update operators ($set, $setOnInsert, $inc, $push
 * with $each/$slice).
 */
import { ObjectId } from 'mongodb'

type Doc = Record<string, any>

function getPath(doc: Doc, path: string) {
  return path.split('.').reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), doc)
}

function setPath(doc: Doc, path: string, value: unknown) {
  const keys = path.split('.')
  let cursor = doc
  for (let i = 0; i < keys.length - 1; i++) {
    if (cursor[keys[i]] == null || typeof cursor[keys[i]] !== 'object') cursor[keys[i]] = {}
    cursor = cursor[keys[i]]
  }
  cursor[keys[keys.length - 1]] = value
}

function eq(a: unknown, b: unknown) {
  if (a instanceof ObjectId || b instanceof ObjectId) return String(a) === String(b)
  if (a instanceof Date || b instanceof Date) return new Date(a as any).getTime() === new Date(b as any).getTime()
  return a === b
}

function matchesCondition(value: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === 'object' && !(cond instanceof Date) && !(cond instanceof ObjectId) && !(cond instanceof RegExp) && !Array.isArray(cond)) {
    return Object.entries(cond as Doc).every(([op, operand]) => {
      switch (op) {
        case '$in': return (operand as unknown[]).some((o) => Array.isArray(value) ? value.some((v) => eq(v, o)) : eq(value, o))
        case '$ne': return !eq(value, operand)
        case '$gt': return value != null && (value as any) > (operand as any)
        case '$gte': return value != null && (value as any) >= (operand as any)
        case '$lt': return value != null && (value as any) < (operand as any)
        case '$type': return operand === 'string' ? typeof value === 'string' : true
        case '$regex': return new RegExp(String(operand), (cond as Doc).$options || '').test(String(value ?? ''))
        case '$options': return true
        default: throw new Error(`fakeMongo: unsupported operator ${op}`)
      }
    })
  }
  if (cond instanceof RegExp) return Array.isArray(value) ? value.some((v) => cond.test(String(v))) : cond.test(String(value ?? ''))
  if (Array.isArray(value) && !Array.isArray(cond)) return value.some((v) => eq(v, cond))
  return eq(value, cond)
}

export function matches(doc: Doc, query: Doc): boolean {
  return Object.entries(query).every(([key, cond]) => {
    if (key === '$or') return (cond as Doc[]).some((sub) => matches(doc, sub))
    if (key === '$and') return (cond as Doc[]).every((sub) => matches(doc, sub))
    return matchesCondition(getPath(doc, key), cond)
  })
}

function applyUpdate(doc: Doc, update: Doc, isInsert: boolean) {
  if (update.$setOnInsert && isInsert) for (const [k, v] of Object.entries(update.$setOnInsert)) setPath(doc, k, v)
  if (update.$set) for (const [k, v] of Object.entries(update.$set)) setPath(doc, k, v)
  if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) setPath(doc, k, (getPath(doc, k) || 0) + (v as number))
  if (update.$push) {
    for (const [k, v] of Object.entries(update.$push as Doc)) {
      const current = Array.isArray(getPath(doc, k)) ? [...getPath(doc, k)] : []
      const spec = v as Doc
      const items = spec && typeof spec === 'object' && '$each' in spec ? spec.$each : [v]
      let next = [...current, ...items]
      if (spec && typeof spec === 'object' && typeof spec.$slice === 'number') {
        next = spec.$slice < 0 ? next.slice(spec.$slice) : next.slice(0, spec.$slice)
      }
      setPath(doc, k, next)
    }
  }
}

function project(doc: Doc, projection?: Doc) {
  if (!projection) return { ...doc }
  const entries = Object.entries(projection)
  const excludes = entries.filter(([, v]) => v === 0).map(([k]) => k)
  const includes = entries.filter(([, v]) => v === 1).map(([k]) => k)
  if (includes.length) {
    const out: Doc = {}
    if (!excludes.includes('_id')) out._id = doc._id
    for (const k of includes) if (getPath(doc, k) !== undefined) setPath(out, k, getPath(doc, k))
    return out
  }
  const out = { ...doc }
  for (const k of excludes) delete out[k]
  return out
}

function sortDocs(docs: Doc[], sort?: Doc) {
  if (!sort) return docs
  const entries = Object.entries(sort)
  return [...docs].sort((a, b) => {
    for (const [key, dir] of entries) {
      const av = getPath(a, key)
      const bv = getPath(b, key)
      if (av === bv) continue
      if (av == null) return 1
      if (bv == null) return -1
      return (av > bv ? 1 : -1) * (dir as number)
    }
    return 0
  })
}

export class FakeCollection {
  docs: Doc[] = []
  uniqueKeys: string[][] = []
  indexList: Doc[] = [{ key: { _id: 1 }, name: '_id_' }]

  constructor(uniqueKeys: string[][] = []) {
    this.uniqueKeys = uniqueKeys
  }

  private assertUnique(candidate: Doc, ignore?: Doc) {
    for (const keys of this.uniqueKeys) {
      const clash = this.docs.find((d) => d !== ignore && keys.every((k) => eq(getPath(d, k), getPath(candidate, k)) && getPath(candidate, k) !== undefined))
      if (clash) {
        const err: any = new Error('E11000 duplicate key')
        err.code = 11000
        throw err
      }
    }
  }

  find(query: Doc = {}, options: Doc = {}) {
    let results = this.docs.filter((d) => matches(d, query))
    let sort: Doc | undefined
    let skip = 0
    let limit = Infinity
    const cursor = {
      sort: (s: Doc) => { sort = s; return cursor },
      skip: (n: number) => { skip = n; return cursor },
      limit: (n: number) => { limit = n; return cursor },
      project: (p: Doc) => { options = { ...options, projection: p }; return cursor },
      toArray: async () => sortDocs(results, sort).slice(skip, skip + limit).map((d) => project(d, options.projection)),
      [Symbol.asyncIterator]: async function* () { for (const d of sortDocs(results, sort).slice(skip, skip + limit)) yield project(d, options.projection) },
    }
    void results
    return cursor
  }

  async findOne(query: Doc = {}, options: Doc = {}) {
    const sorted = sortDocs(this.docs.filter((d) => matches(d, query)), options.sort)
    return sorted.length ? project(sorted[0], options.projection) : null
  }

  async insertOne(doc: Doc) {
    const stored = { _id: doc._id ?? new ObjectId(), ...doc }
    this.assertUnique(stored)
    this.docs.push(stored)
    return { acknowledged: true, insertedId: stored._id }
  }

  async updateOne(query: Doc, update: Doc, options: Doc = {}) {
    const existing = this.docs.find((d) => matches(d, query))
    if (existing) {
      applyUpdate(existing, update, false)
      this.assertUnique(existing, existing)
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null }
    }
    if (options.upsert) {
      const seed: Doc = {}
      for (const [k, v] of Object.entries(query)) if (typeof v !== 'object' || v === null) setPath(seed, k, v)
      applyUpdate(seed, update, true)
      const stored = { _id: new ObjectId(), ...seed }
      this.assertUnique(stored)
      this.docs.push(stored)
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: stored._id }
    }
    return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0, upsertedId: null }
  }

  async updateMany(query: Doc, update: Doc) {
    let modified = 0
    for (const doc of this.docs) {
      if (!matches(doc, query)) continue
      applyUpdate(doc, update, false)
      modified += 1
    }
    return { matchedCount: modified, modifiedCount: modified }
  }

  async findOneAndUpdate(query: Doc, update: Doc, options: Doc = {}) {
    await this.updateOne(query, update, options)
    return { value: await this.findOne(query), ok: 1 }
  }

  async deleteOne(query: Doc) {
    const idx = this.docs.findIndex((d) => matches(d, query))
    if (idx === -1) return { deletedCount: 0 }
    this.docs.splice(idx, 1)
    return { deletedCount: 1 }
  }

  async deleteMany(query: Doc) {
    const before = this.docs.length
    this.docs = this.docs.filter((d) => !matches(d, query))
    return { deletedCount: before - this.docs.length }
  }

  async countDocuments(query: Doc = {}) {
    return this.docs.filter((d) => matches(d, query)).length
  }

  async estimatedDocumentCount() {
    return this.docs.length
  }

  async distinct(field: string) {
    return Array.from(new Set(this.docs.map((d) => getPath(d, field)).filter((v) => v !== undefined)))
  }

  async bulkWrite(ops: Doc[]) {
    let upsertedCount = 0
    for (const op of ops) {
      if (op.updateOne) {
        const result = await this.updateOne(op.updateOne.filter, op.updateOne.update, { upsert: op.updateOne.upsert })
        upsertedCount += result.upsertedCount
      }
    }
    return { upsertedCount }
  }

  aggregate(_pipeline: Doc[]) {
    // Callers that need aggregation override this per test.
    return { toArray: async () => [] as Doc[], [Symbol.asyncIterator]: async function* () { /* empty */ } }
  }

  async createIndex(keys: Doc, options: Doc = {}) {
    this.indexList.push({ key: keys, ...options })
    return options.name || Object.keys(keys).join('_')
  }

  async indexes() {
    return this.indexList
  }
}

/** In-memory Upstash-like Redis supporting the commands lib/users.ts uses. */
export class FakeRedis {
  store = new Map<string, { value: string; expiresAt: number | null }>()

  private live(key: string) {
    const entry = this.store.get(key)
    if (!entry) return null
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) { this.store.delete(key); return null }
    return entry
  }

  async get(key: string) { return this.live(key)?.value ?? null }
  async set(key: string, value: unknown, opts?: { ex?: number }) {
    this.store.set(key, { value: typeof value === 'string' ? value : JSON.stringify(value), expiresAt: opts?.ex ? Date.now() + opts.ex * 1000 : null })
    return 'OK'
  }
  async setex(key: string, seconds: number, value: unknown) { return this.set(key, value, { ex: seconds }) }
  async del(...keys: string[]) { let n = 0; for (const k of keys) if (this.store.delete(k)) n++; return n }
  async mget(...keys: string[]) { return keys.map((k) => this.live(k)?.value ?? null) }
  async scan(_cursor: string | number, opts: { match?: string } = {}) {
    const re = opts.match ? new RegExp(`^${opts.match.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`) : null
    const keys = Array.from(this.store.keys()).filter((k) => this.live(k) && (!re || re.test(k)))
    return ['0', keys] as [string, string[]]
  }
  ttl(key: string) {
    const entry = this.live(key)
    if (!entry) return -2
    return entry.expiresAt === null ? -1 : Math.round((entry.expiresAt - Date.now()) / 1000)
  }
}
