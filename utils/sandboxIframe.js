/**
 * iframe `sandbox` token string for the benchmark runner.
 *
 * - **Production:** `allow-scripts` only → opaque origin; user code cannot use same-origin
 *   access to the parent. Requires `/_next` CORS headers (see next.config.js).
 * - **Development:** also `allow-same-origin` so the iframe matches the app origin.
 *   Otherwise Turbopack can respond **403** to some `/_next/static/development/*` requests
 *   from an opaque-origin iframe (`_clientMiddlewareManifest.js`, etc.).
 */
export const SANDBOX_IFRAME_FLAGS =
  process.env.NODE_ENV === 'development'
    ? 'allow-scripts allow-same-origin'
    : 'allow-scripts'
