module.exports = {
  transpilePackages: ['codejar'],
  /**
   * Production sandbox iframes omit `allow-same-origin` (opaque origin). Client chunks
   * are then cross-origin; ACAO * allows them to load. In development, iframes use
   * `allow-same-origin` so Turbopack does not 403 `/_next/static/development/*`.
   */
  async headers() {
    return [
      {
        source: '/_next/:path*',
        headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }],
      },
      {
        source: '/:path*.webp',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/:path*.png',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ]
  },
}
