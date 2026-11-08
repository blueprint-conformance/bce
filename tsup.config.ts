import { defineConfig } from 'tsup';
import { publishShrinkwrapSha256 } from './scripts/lib/publish-shrinkwrap.mjs';

// The digest of the shrinkwrap a consumer installs: the production-only publish form.
const dependencyLockSha256 = publishShrinkwrapSha256();

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts', 'src/mcp-server.ts'],
  format: ['esm', 'cjs'],
  dts: false,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  target: 'es2022',
  outDir: 'dist',
  platform: 'node',
  // npm-shrinkwrap.json is published (production-only, scripts/lib/publish-shrinkwrap.mjs)
  // and freezes the full runtime tree. The two public runtime dependencies also remain exact.
  external: ['zod', 'ts-morph'],
  define: {
    __BCE_DEPENDENCY_LOCK_SHA256__: JSON.stringify(dependencyLockSha256),
  },
  // the bins are invoked directly: `bce` → dist/cli.js, `bce-mcp` → dist/mcp-server.js; give the
  // ESM output a node shebang. (Source files carry NO shebang — the banner is the single source.)
  banner: ({ format }) => (format === 'esm' ? { js: '#!/usr/bin/env node' } : {}),
});
