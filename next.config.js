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
    ]
  },
}
