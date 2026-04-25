# TypeScript Migration Notes

The application, tests, shared libraries, and worker source have been renamed to
TypeScript entry points. Remaining JavaScript files are intentional exceptions:

- `lib/runsSchema.js` is a Mongo shell schema/index script, not an imported app
  module.
- `worker/coverage/*.js` are generated coverage report assets.
- `postcss.config.mjs`, `vitest.config.mjs`, and `worker/vitest.config.mjs`
  remain JavaScript config files.
- `scripts/test-engines.mjs` remains an executable local script.

Many legacy application files are currently marked with `// @ts-nocheck` after
the mechanical conversion. The benchmark source-preparation modules are typed
first because they are the runtime TypeScript compiler path for user snippets.
