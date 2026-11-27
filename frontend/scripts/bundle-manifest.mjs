import { relative } from 'node:path'

// Module names only: opt-in diagnostics do not publish application source.
export function bundleModuleMap() {
  let root
  return {
    name: 'bundle-module-map',
    apply: 'build',
    configResolved(config) {
      root = config.root
    },
    generateBundle(_options, bundle) {
      if (!process.env.BUNDLE_ANALYZE) return
      const chunks = {}
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        chunks[output.fileName] = Object.keys(output.modules)
          .map((id) => relative(root, id).replaceAll('\\', '/'))
          .sort()
      }
      this.emitFile({
        type: 'asset',
        fileName: '.vite/chunk-modules.json',
        source: JSON.stringify({ version: 1, chunks }, null, 2),
      })
    },
  }
}
