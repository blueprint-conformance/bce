#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const checker = join(root, 'scripts', 'verify-external-implementation-report.mjs');
const vectors = JSON.parse(readFileSync(join(root, 'spec', 'conformance-vectors', 'vectors.json'), 'utf8'));
const vectorSet = JSON.parse(readFileSync(join(root, 'spec', 'conformance-vectors', 'vector-set.json'), 'utf8'));
const report = {
  schemaVersion: '1',
  implementation: { name: 'negative-control', repository: 'https://github.com/blueprint-conformance/bce', revision: 'a'.repeat(40), release: 'test', maintainerControlledByBce: false },
  vectorSet: { apiVersion: 'blueprint-conformance/v1alpha1', sha256: vectorSet.vectorsSha256 },
  environment: { runtime: 'test' },
  assessments: vectors.vectors.map((vector) => ({ id: vector.id, actualVerdict: vector.expectedVerdict, actualExitCode: vector.expectedExitCode })),
  evidence: { publicRunUrl: 'https://example.invalid/run', runOutputSha256: 'b'.repeat(64) },
  adjudication: { status: 'pending', reviewIssue: 'https://example.invalid/issue' },
};
const file = join(mkdtempSync(join(tmpdir(), 'bce-external-report-')), 'report.json');
writeFileSync(file, JSON.stringify(report));
try {
  execFileSync(process.execPath, [checker, file], { stdio: ['ignore', 'pipe', 'pipe'] });
  throw new Error('external-report checker accepted BCE itself as the external implementation');
} catch (error) {
  if (error.status !== 1 || !String(error.stderr).includes('not an external implementation')) throw error;
}
console.log('external-implementation self-test: PASS (BCE-owned implementation rejected)');
