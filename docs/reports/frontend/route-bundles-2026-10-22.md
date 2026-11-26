# Route bundle measurement — 2026-10-22

Login now transfers **290,742 bytes gzip**, down **41.2%** from 494,529 bytes.
Marketing home transfers **299,977 bytes gzip**, down **39.3%**.
These figures include the complete cold JavaScript and CSS graph for each route,
including shared dependencies. They are not the size of a single entry file.

The source-module audit found no Manager, inventory, reports, or reconciliation
modules in the entry, login, marketing home, or PMS dashboard graphs. Inventory
and reports stay separate from each other and from Manager.

## Method

- Environment: Node v26.12.0, npm 12.2.1, Vite 8.2.2, production minification.
- Baseline: commit `1f079f8574ff75d4f343bf4468d3d1875e0504ad`, with the
  original eager `App.jsx` imports and original `manualChunks` configuration.
- That commit contained unresolved conflict markers in `BookingModal.jsx`,
  `BookingTabs.jsx`, and `OTAHistory.jsx`, preventing a production build. Those
  conflicts were resolved before capturing the baseline; the same resolutions
  are present in the optimized build. Draft protection, busy states, history
  filters/details, and translated labels were retained.
- The baseline was built before changing routing/configuration using
  `npm run build -- --manifest --sourcemap hidden`. Hidden source maps supplied
  module provenance for the old build and do not change emitted JavaScript.
- The optimized build uses `BUNDLE_ANALYZE=1 npm run build` to emit
  `.vite/chunk-modules.json`, containing module names without source contents.
  Normal builds do not emit that diagnostic map.
- `scripts/measure-bundle.mjs` starts at the HTML entry and the matched lazy
  layout/page. It follows the Vite manifest's static `imports` and `css`, dedupes
  assets, and excludes unopened `dynamicImports`.
- Every JS/CSS file is compressed independently with gzip level 9 and Brotli
  quality 11. Sizes are bytes, with an empty browser cache. HTML, images, fonts,
  source maps, diagnostic manifests, API payloads, and HTTP headers are excluded.
  The numbers describe build graphs rather than browser timings or API latency.

The compact [measurement snapshot](route-bundles-2026-10-22.json) records exact
before/after totals, baseline assets, optimized entry assets, compression settings,
and module-isolation counts. `--out` also supports a full per-asset JSON report.

## Cold-route JS + CSS

Every baseline route loaded the same five eager assets: **1,950,776 raw bytes**,
**494,529 gzip bytes**, or **366,770 Brotli bytes**.

| Route | After files | After raw | After gzip | Gzip reduction | After Brotli | Brotli reduction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Entry before rendering a route | 9 | 922,229 | 283,626 | 42.6% | 218,368 | 40.5% |
| `/id/login` | 19 | 941,551 | 290,742 | 41.2% | 224,496 | 38.8% |
| `/` | 27 | 975,452 | 299,977 | 39.3% | 232,670 | 36.6% |
| `/id/dashboard` | 41 | 1,004,696 | 309,038 | 37.5% | 240,698 | 34.4% |
| `/manager/dashboard` | 36 | 987,918 | 304,960 | 38.3% | 237,105 | 35.4% |
| `/id/inventory/in` | 45 | 1,006,272 | 311,743 | 37.0% | 243,127 | 33.7% |
| `/id/reports` | 42 | 1,003,920 | 310,538 | 37.2% | 242,036 | 34.0% |

Protected-route measurements assume an authorized user whose route renders. A
rejected permission check does not render the lazy protected page. Deep-link and
permission behavior is covered by `src/app/App.test.js`.

## Isolation and tradeoffs

`npm run bundle:measure -- --check` passes against the optimized build. It checks
actual source-module membership of every transitive static chunk, so a feature
cannot hide inside a shared chunk and evade the audit by changing its filename.

| Cold graph | Manager modules | Inventory modules | Reports/reconciliation modules |
| --- | ---: | ---: | ---: |
| Entry | 0 | 0 | 0 |
| Login | 0 | 0 | 0 |
| Marketing home | 0 | 0 | 0 |
| PMS dashboard | 0 | 0 | 0 |

The checked graphs also contain zero Recharts/D3 and Framer Motion modules;
those dependencies are currently unused throughout the emitted application.
The remaining 557,117-byte raw shared chunk consists of React and the existing
locale catalogs. It causes Vite's 500 kB warning and remains a separate possible
optimization.

Splitting increases the sum of **all** emitted JS/CSS files from 5 to 160 files:
gzip increases from 494,529 to 582,970 bytes (+17.9%); Brotli increases from
366,770 to 482,206 bytes (+31.5%). Smaller independently compressed files lose
cross-file compression opportunities and add import/header overhead. An individual
cold route downloads only the subset in the table; later routes reuse cached
shared files.

## Reproduce the optimized measurement

From `frontend/`:

```sh
npm ci --include=dev
BUNDLE_ANALYZE=1 npm run build
npm run bundle:measure -- --check --out /tmp/route-bundles.json
```

For an archived build with a manifest and either the diagnostic module map or
hidden source maps:

```sh
node scripts/measure-bundle.mjs --dist /path/to/archived/dist --out /tmp/baseline.json
```

The baseline was captured before the routing edits, after resolving the three
build-blocking conflicts above. To rebuild that baseline independently, use the
referenced commit, apply those same three resolutions, and build with the baseline
command above. `--check` is expected to reject the baseline because it includes
all feature modules eagerly.
