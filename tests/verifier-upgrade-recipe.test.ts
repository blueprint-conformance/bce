import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('installed verifier qualification recipe', () => {
  it('captures immutable source twice and refuses incomplete or altered evidence without replaying historical reports', () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-upgrade-recipe-test-'));
    try {
      // Source-built archive identity for this test; the package proof separately uses the actual npm tarball.
      // Do not invoke npm pack inside a test: prepare can rebuild shared dist while other tests read it.
      const tarball = path.join(scratch, 'source-build.tgz');
      execFileSync('tar', ['-czf', tarball, '-C', process.cwd(), 'package.json', 'npm-shrinkwrap.json', 'dist']);
      const result = spawnSync(process.execPath, ['examples/verifier-upgrade/proof.mjs', process.cwd(), tarball], { encoding: 'utf8', timeout: 60_000 });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('24 controls, data-only comparison PASS');
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  }, 90_000);
});
