/**
 * Static complexity engine client.
 *
 * The parser/estimator runs on the remote benchmark worker so the Vercel app
 * does not install native parser dependencies or execute complex static
 * analysis locally.
 */

export async function estimateComplexitiesOnWorker(tests, {
  setup,
  language,
  languageOptions,
  sourceMode,
  signal,
} = {}) {
  const workerUrl = process.env.BENCHMARK_WORKER_URL
  if (!workerUrl) return null

  let response
  try {
    response = await fetch(`${workerUrl.replace(/\/+$/, '')}/api/complexity`, {
      method: 'POST',
      headers: workerHeaders(),
      body: JSON.stringify({ tests, setup, language, languageOptions, sourceMode }),
      signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    return { unavailable: true, error: `Worker unreachable: ${err.message || String(err)}` }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return { unavailable: true, error: `Worker error ${response.status}: ${text.slice(0, 200)}` }
  }

  const body = await response.json().catch(() => null)
  if (!Array.isArray(body?.results)) {
    return { unavailable: true, error: 'Worker response missing complexity results' }
  }

  return body.results.map(result => result?.complexity || null)
}

function workerHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (process.env.BENCHMARK_WORKER_SECRET) {
    headers.Authorization = `Bearer ${process.env.BENCHMARK_WORKER_SECRET}`
  }
  return headers
}
