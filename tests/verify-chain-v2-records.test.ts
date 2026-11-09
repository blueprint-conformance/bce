/**
 * Declared-stack (v2) reports produce evidence records with `score: null` when indeterminate, the
 * two stack digests, and a toolchain that names its providers. The zero-dependency verifier must
 * accept exactly those genuine shapes (and agree with the engine), and still refuse malformed ones.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { toEvidenceRecord, verifyEvidenceChain, type EvidenceRecord, type EvidenceToolchainIdentity } from '../src/emit.js';
import type { ComplianceReport } from '../src/report.js';

const VERIFIER = path.join(__dirname, '..', 'tools', 'verify-chain.mjs');
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const hex = (c: string) => c.repeat(64);
const toolchain = {
  engine: { name: 'bce-engine', version: '0.6.2' },
  dependencyLock: { file: 'npm-shrinkwrap.json', sha256: hex('a') },
  runtime: { node: '22.23.4', npm: '10.9.3', platform: 'linux', arch: 'x64' },
  providers: [
    { evidenceClass: 'staticAst', kind: 'ast', profile: 'typescript-module-graph', provider: 'typescript-ts-morph', version: '0.6.2' },
    { evidenceClass: 'declaredStack', provider: 'selected-stack-v1', version: '0.6.2' },
  ],
} as unknown as EvidenceToolchainIdentity;

function v2Report(verdict: 'pass' | 'indeterminate'): ComplianceReport {
  return {
    schemaVersion: '2',
    blueprintRef: 'stack-policy@1.0.0',
    ctRepoRevision: 'abc123',
    score: verdict === 'pass' ? 100 : null,
    verdict,
    violations: [],
    evidenceRef: `declared-stack-facts.json@sha256:${hex('b')}`,
    stack: { stackDigest: hex('c'), manifestDigest: hex('d') },
  } as unknown as ComplianceReport;
}

function writeChain(records: object[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-v2-chain-'));
  dirs.push(dir);
  records.forEach((r, i) => fs.writeFileSync(path.join(dir, `record-${String(i + 1).padStart(3, '0')}.json`), JSON.stringify(r, null, 2)));
  return dir;
}

const verify = (dir: string) => spawnSync(process.execPath, [VERIFIER, dir], { encoding: 'utf8' });

describe('verify-chain.mjs on declared-stack (v2) records', () => {
  const first = toEvidenceRecord(v2Report('indeterminate'), undefined, toolchain);
  const second = toEvidenceRecord(v2Report('pass'), first.hash, toolchain);

  it('verifies genuine v2 records and agrees with the engine', () => {
    expect(first).toMatchObject({ score: null, verdict: 'indeterminate', stackDigest: hex('c'), manifestDigest: hex('d') });
    const run = verify(writeChain([first, second]));
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('CHAIN INTACT');
    expect(verifyEvidenceChain([first, second] as EvidenceRecord[])).toBe(-1);
  });

  it('refuses a record that carries only one stack digest', () => {
    const { manifestDigest, ...partial } = first;
    void manifestDigest;
    const run = verify(writeChain([partial]));
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("'stackDigest' and 'manifestDigest' must appear together");
  });

  it('refuses a null score on a record that is not indeterminate', () => {
    const run = verify(writeChain([{ ...second, previousHash: hex('0'), score: null }]));
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("'score' must be a number, or null exactly when 'verdict' is 'indeterminate'");
  });
});
