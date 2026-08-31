import { defineConfig } from 'tsup';

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
  external: ['zod', 'ts-morph'],
  // the bins are invoked directly: `bce` → dist/cli.js, `bce-mcp` → dist/mcp-server.js; give the
  // ESM output a node shebang. (Source files carry NO shebang — the banner is the single source.)
  banner: ({ format }) => (format === 'esm' ? { js: '#!/usr/bin/env node' } : {}),
});
