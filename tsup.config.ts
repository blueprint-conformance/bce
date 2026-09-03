import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const dependencyLockSha256 = createHash('sha256').update(readFileSync('npm-shrinkwrap.json')).digest('hex');

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
  // npm-shrinkwrap.json is published with the package and freezes the full
  // runtime tree. The two public runtime dependencies also remain exact.
  external: ['zod', 'ts-morph'],
  define: {
    __BCE_DEPENDENCY_LOCK_SHA256__: JSON.stringify(dependencyLockSha256),
  },
  // the bins are invoked directly: `bce` → dist/cli.js, `bce-mcp` → dist/mcp-server.js; give the
  // ESM output a node shebang. (Source files carry NO shebang — the banner is the single source.)
  banner: ({ format }) => (format === 'esm' ? { js: '#!/usr/bin/env node' } : {}),
});
