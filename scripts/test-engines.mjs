#!/usr/bin/env node
/**
 * Local test script for the deep analysis engines.
 *
 * Usage:
 *   node scripts/test-engines.mjs                # QuickJS only (no credentials needed)
 *   node scripts/test-engines.mjs --with-sandbox  # QuickJS + Vercel Sandbox (needs vercel link)
 */

import { runInQuickJS } from '../lib/engines/quickjs.js'

const withSandbox = process.argv.includes('--with-sandbox')

const tests = [
  { title: 'for loop', code: 'var s = 0; for (var i = 0; i < 100; i++) s += i;' },
  { title: 'Array.reduce', code: 'Array.from({length: 100}, (_, i) => i).reduce((s, v) => s + v, 0);' },
]

console.log('=== QuickJS-WASM Engine (deterministic, no JIT) ===\n')

for (const test of tests) {
  const result = await runInQuickJS(test.code, { timeMs: 1000 })
  console.log(`  ${test.title}:`)
  console.log(`    State: ${result.state}`)
  console.log(`    Ops/sec: ${result.opsPerSec.toLocaleString()}`)
  console.log(`    Mean latency: ${(result.latency.mean * 1000).toFixed(1)}µs`)
  console.log(`    P99 latency: ${(result.latency.p99 * 1000).toFixed(1)}µs`)
  console.log(`    Memory: ${result.memoryUsed.totalBytes.toLocaleString()} bytes`)
  console.log(`    Samples: ${result.latency.samplesCount}`)
  console.log()
}

if (withSandbox) {
  console.log('=== V8 Sandbox Engine (Firecracker microVM, JIT) ===\n')

  try {
    const { runInV8Sandbox } = await import('../lib/engines/v8sandbox.js')

    for (const test of tests) {
      console.log(`  Running "${test.title}" in Firecracker microVM...`)
      const result = await runInV8Sandbox(test.code, { timeMs: 1000 })
      console.log(`    State: ${result.state}`)
      if (result.state === 'completed') {
        console.log(`    Ops/sec: ${result.opsPerSec.toLocaleString()}`)
        console.log(`    Mean latency: ${(result.latency.mean * 1000).toFixed(1)}µs`)
        console.log(`    Heap used: ${(result.heapUsed / 1024 / 1024).toFixed(1)}MB`)
      } else {
        console.log(`    Error: ${result.error}`)
      }
      console.log()
    }

    // Show JIT amplification
    console.log('=== JIT Amplification ===\n')
    for (const test of tests) {
      const qjs = await runInQuickJS(test.code, { timeMs: 500 })
      const v8 = await runInV8Sandbox(test.code, { timeMs: 500 })
      if (qjs.opsPerSec > 0 && v8.opsPerSec > 0) {
        const ratio = (v8.opsPerSec / qjs.opsPerSec).toFixed(1)
        console.log(`  ${test.title}: ${ratio}x (V8 JIT is ${ratio}x faster than interpreter)`)
      }
    }
  } catch (e) {
    console.error('  Sandbox error:', e.message)
    console.error()
    console.error('  To use the V8 Sandbox locally:')
    console.error('    1. npm i -g vercel')
    console.error('    2. vercel link        (link to your Vercel project)')
    console.error('    3. vercel env pull    (pull OIDC token to .env.local)')
    console.error('    4. node scripts/test-engines.mjs --with-sandbox')
  }
} else {
  console.log('---')
  console.log('Tip: Run with --with-sandbox to also test V8 in a Firecracker microVM.')
  console.log('Requires: vercel link && vercel env pull')
}
