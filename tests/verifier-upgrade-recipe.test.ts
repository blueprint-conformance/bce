import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('installed verifier qualification recipe', () => {
  it('captures immutable source twice and refuses incomplete or altered evidence without replaying historical reports', () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-upgrade-recipe-test-'));
    try {
      // A running Vitest workspace is not an immutable installed artifact: it writes
      // transform caches under node_modules. Copy the locked production closure into
      // a private package; identify() must still inventory every byte in that tree.
      const packageRoot = path.join(scratch, 'source-package');
      fs.mkdirSync(packageRoot);
      for (const file of ['package.json', 'npm-shrinkwrap.json', 'dist']) {
        fs.cpSync(path.join(process.cwd(), file), path.join(packageRoot, file), { recursive: true });
      }
      const lock = JSON.parse(fs.readFileSync(path.join(packageRoot, 'npm-shrinkwrap.json'), 'utf8')) as {
        packages: Record<string, { dev?: boolean }>;
      };
      for (const [relative, dependency] of Object.entries(lock.packages)) {
        if (!relative || dependency.dev === true) continue;
        fs.cpSync(path.join(process.cwd(), relative), path.join(packageRoot, relative), { recursive: true });
      }
      // Source-built archive identity for this test; the package proof separately uses the actual npm tarball.
      // Do not invoke npm pack inside a test: prepare can rebuild shared dist while other tests read it.
      const tarball = path.join(scratch, 'source-build.tgz');
      execFileSync('tar', ['-czf', tarball, '-C', packageRoot, 'package.json', 'npm-shrinkwrap.json', 'dist']);
      const result = spawnSync(process.execPath, ['examples/verifier-upgrade/proof.mjs', packageRoot, tarball], { encoding: 'utf8', timeout: 60_000 });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('39 controls, data-only comparison PASS');
      // Real dependency-byte mutation must still invalidate an admitted artifact.
      // Only this test's private copy is changed; production identity logic stays strict.
      const tamperScript = path.join(scratch, 'dependency-tamper.mjs');
      fs.writeFileSync(tamperScript, `
        import assert from 'node:assert/strict';
        import fs from 'node:fs';
        import path from 'node:path';
        import { pathToFileURL } from 'node:url';
        const [recipe, packageRoot, tarball, scratch] = process.argv.slice(2);
        const { identify, capture } = await import(pathToFileURL(recipe));
        const admission = { ...identify(packageRoot, tarball), provenance: 'Private test artifact admitted before tampering.' };
        const identityFile = path.join(scratch, 'identity.json');
        fs.writeFileSync(identityFile, JSON.stringify(admission));
        fs.appendFileSync(path.join(packageRoot, 'node_modules/zod/package.json'), '\\n');
        assert.notEqual(identify(packageRoot, tarball).artifact.dependencyTreeSha256, admission.artifact.dependencyTreeSha256);
        await assert.rejects(capture(identityFile, packageRoot, '0'.repeat(40), path.join(scratch, 'tampered')),
          /artifact bytes or toolchain differ from the reviewed identity record/);
        console.log('actual dependency mutation refused');
      `);
      const tamper = spawnSync(process.execPath, [tamperScript, path.resolve('examples/verifier-upgrade/capture.mjs'), packageRoot, tarball, scratch], { encoding: 'utf8', timeout: 60_000 });
      expect(tamper.status, tamper.stderr).toBe(0);
      expect(tamper.stdout).toContain('actual dependency mutation refused');
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  }, 90_000);
});
