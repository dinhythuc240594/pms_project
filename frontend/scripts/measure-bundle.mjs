import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const usage = `Measure cold-route production JS/CSS transfer sizes.

  BUNDLE_ANALYZE=1 npm run build
  npm run bundle:measure -- [--dist dist] [--out report.json] [--check]

--check rejects Manager/inventory/report modules in entry, login, marketing,
and PMS dashboard static graphs. Build with BUNDLE_ANALYZE=1 for provenance.
Hidden source maps are also supported for measuring an older baseline.
Only static imports and CSS of the opened route are followed; other dynamic
imports, source maps, diagnostics, fonts, images, and HTTP headers are excluded.
`

const args = process.argv.slice(2)
let dist = 'dist'
let out
let check = false
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]
  if (arg === '--help') {
    console.log(usage)
    process.exit(0)
  } else if (arg === '--check') check = true
  else if (arg === '--dist' || arg === '--out') {
    const value = args[++index]
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a path`)
    if (arg === '--dist') dist = value
    else out = value
  } else throw new Error(`Unknown option: ${arg}\n${usage}`)
}

dist = resolve(dist)
let manifest
try {
  manifest = JSON.parse(await readFile(join(dist, '.vite/manifest.json'), 'utf8'))
} catch (error) {
  throw new Error(`Cannot read the Vite manifest in ${dist}; run npm run build first.`, {
    cause: error,
  })
}

const sourceName = (source) => source.replaceAll('\\', '/').replace(/^.*?(?=src\/apps\/)/, '')
let moduleMap
try {
  moduleMap = JSON.parse(await readFile(join(dist, '.vite/chunk-modules.json'), 'utf8')).chunks
} catch (error) {
  if (error.code !== 'ENOENT') throw error
  moduleMap = {}
  for (const entry of Object.values(manifest)) {
    if (!entry.file.endsWith('.js')) continue
    try {
      const sourceMap = JSON.parse(await readFile(join(dist, `${entry.file}.map`), 'utf8'))
      moduleMap[entry.file] = sourceMap.sources.map(sourceName)
    } catch (mapError) {
      if (mapError.code !== 'ENOENT') throw mapError
    }
  }
  if (!Object.keys(moduleMap).length && check) {
    throw new Error(
      'Module provenance is unavailable. Rebuild with BUNDLE_ANALYZE=1 npm run build.',
    )
  }
}

function staticGraph(roots) {
  const visited = new Set()
  const files = new Set()
  const modules = new Set()
  function visit(key) {
    if (visited.has(key)) return
    const entry = manifest[key]
    if (!entry) throw new Error(`Manifest entry not found: ${key}`)
    visited.add(key)
    files.add(entry.file)
    for (const css of entry.css || []) files.add(css)
    for (const source of moduleMap[entry.file] || []) modules.add(sourceName(source))
    for (const imported of entry.imports || []) visit(imported)
  }
  roots.forEach(visit)
  return { files: [...files].sort(), modules: [...modules].sort() }
}

const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry && key.endsWith('.html'))
if (!entryKey) throw new Error('No HTML entry point found in the Vite manifest.')
const entryGraph = staticGraph([entryKey])

const routeDefinitions = [
  { name: 'entry', path: '(before route renders)', sources: [] },
  {
    name: 'login',
    path: '/id/login',
    sources: ['pms/auth/layouts/AuthLayout.jsx', 'pms/auth/pages/Login.jsx'],
  },
  {
    name: 'marketing',
    path: '/',
    sources: ['marketing/layouts/MarketingLayout.jsx', 'marketing/Home.jsx'],
  },
  {
    name: 'pms',
    path: '/id/dashboard',
    sources: ['pms/layouts/PmsLayout.jsx', 'pms/dashboard/pages/Dashboard.jsx'],
  },
  {
    name: 'manager',
    path: '/manager/dashboard',
    sources: ['manager/layouts/ManagerLayout.jsx', 'manager/dashboard/pages/AdminDashboard.jsx'],
  },
  {
    name: 'inventory',
    path: '/id/inventory/in',
    sources: ['pms/layouts/PmsLayout.jsx', 'pms/inventory/pages/InventoryIn.jsx'],
  },
  {
    name: 'reports',
    path: '/id/reports',
    sources: ['pms/layouts/PmsLayout.jsx', 'pms/reports/pages/Reports.jsx'],
  },
]

function routeRoots(sources) {
  return [
    entryKey,
    ...sources.flatMap((source) => {
      const key = `src/apps/${source}`
      if (manifest[key]) return [key]
      // Before splitting, each route already lives in the initial static graph.
      if (entryGraph.modules.some((module) => module.split('?')[0] === key)) return []
      throw new Error(
        `Cannot locate ${key} in the manifest or initial modules; update routeDefinitions if route boundaries changed.`,
      )
    }),
  ]
}

const sizeCache = new Map()
async function measureFiles(files) {
  const totals = { raw: 0, gzip: 0, brotli: 0 }
  const assets = []
  for (const file of files) {
    if (!/\.(?:js|css)$/.test(file)) continue
    if (!sizeCache.has(file)) {
      const buffer = await readFile(join(dist, file))
      sizeCache.set(file, {
        raw: buffer.length,
        gzip: gzipSync(buffer, { level: 9 }).length,
        brotli: brotliCompressSync(buffer, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })
          .length,
      })
    }
    const sizes = sizeCache.get(file)
    assets.push({ file, ...sizes })
    for (const key of Object.keys(totals)) totals[key] += sizes[key]
  }
  return { ...totals, assetCount: assets.length, assets }
}

const groups = {
  manager: (source) => source.startsWith('src/apps/manager/'),
  inventory: (source) => source.startsWith('src/apps/pms/inventory/'),
  reports: (source) =>
    source.startsWith('src/apps/pms/reports/') || source.startsWith('src/apps/pms/reconciliation/'),
}
const violations = []
const routes = []
for (const definition of routeDefinitions) {
  const roots = routeRoots(definition.sources)
  const graph = staticGraph(roots)
  const forbiddenGroups = ['entry', 'login', 'marketing', 'pms'].includes(definition.name)
    ? ['manager', 'inventory', 'reports']
    : Object.keys(groups).filter((group) => group !== definition.name)
  const forbiddenModules = graph.modules.filter((source) =>
    forbiddenGroups.some((group) => groups[group](source)),
  )
  if (forbiddenModules.length)
    violations.push({ route: definition.name, modules: forbiddenModules })
  routes.push({
    name: definition.name,
    path: definition.path,
    roots,
    ...(await measureFiles(graph.files)),
    forbiddenModules,
  })
}

async function allAssets(directory, prefix = '') {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = join(prefix, entry.name)
    if (entry.isDirectory()) files.push(...(await allAssets(join(directory, entry.name), name)))
    else if (/\.(?:js|css)$/.test(name)) files.push(name)
  }
  return files.sort()
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  compression: { gzipLevel: 9, brotliQuality: 11, unit: 'bytes', independentFileCompression: true },
  scope:
    'Cold JS/CSS route graph: HTML entry plus matched lazy layout/page, following static imports and CSS only.',
  moduleProvenance: Object.keys(moduleMap).length > 0,
  total: await measureFiles(await allAssets(dist)),
  routes,
  violations,
}

console.table(
  routes.map(({ name, path, raw, gzip, brotli, assetCount }) => ({
    route: name,
    path,
    files: assetCount,
    raw,
    gzip,
    brotli,
  })),
)
console.log(
  `All emitted JS/CSS: raw=${report.total.raw}, gzip=${report.total.gzip}, brotli=${report.total.brotli} bytes.`,
)
console.log('Compression: gzip level 9; Brotli quality 11; each file compressed independently.')
if (out) {
  await writeFile(resolve(out), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`JSON report: ${resolve(out)}`)
}
if (check) {
  if (violations.length) {
    for (const violation of violations)
      console.error(`${violation.route}: unexpected modules:\n${violation.modules.join('\n')}`)
    process.exitCode = 1
  } else console.log('PASS: route graphs exclude unopened Manager, inventory, and report modules.')
}
