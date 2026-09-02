#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixture = mkdtempSync(join(tmpdir(), 'bce-adoption-program-'));
mkdirSync(join(fixture, 'research', 'adoption-records'), { recursive: true });
for (const file of ['research/adoption-record.schema.json', 'research/adoption-program.json', 'release-state.json', 'ATTESTATIONS.md']) {
  const target = join(fixture, file);
  mkdirSync(resolve(target, '..'), { recursive: true });
  cpSync(join(root, file), target);
}
const stage = { status: 'completed', minutes: 1 };
const record = {
  schemaVersion: '1', participantId: 'author-probe',
  relationship: { disclosed: 'project author', authorControlledMachine: true, authorOperatedRun: true },
  source: { kind: 'git-commit', identity: 'a'.repeat(40) },
  environment: { os: 'test', architecture: 'arm64', node: 'v22.22.2', installSource: 'source' },
  journey: {
    outcome: 'success', startedAt: '2026-09-02T10:00:00Z', endedAt: '2026-09-02T10:08:00Z', minutes: 8,
    stages: { install: stage, initialize: stage, authorBlueprint: stage, green: stage, plantDrift: stage, red: stage, fix: stage, greenAgain: stage },
    helpRequests: 0, unexpectedFailures: [], abandonmentReason: null,
  },
  evidence: { publicUrl: 'https://example.invalid/probe', transcriptSha256: 'b'.repeat(64) },
  consent: { publishRecord: true, quoteParticipant: false },
  adjudication: { status: 'accepted-independent', reviewer: 'reviewer', reviewedAt: '2026-09-02T11:00:00Z', notes: 'negative control' },
};
writeFileSync(join(fixture, 'research', 'adoption-records', 'probe.json'), JSON.stringify(record));
const program = JSON.parse(readFileSync(join(fixture, 'research', 'adoption-program.json'), 'utf8'));
Object.assign(program.outcomes, { started: 1, success: 1, failure: 0, abandoned: 0, acceptedIndependent: 1 });
writeFileSync(join(fixture, 'research', 'adoption-program.json'), JSON.stringify(program));
const release = JSON.parse(readFileSync(join(fixture, 'release-state.json'), 'utf8'));
release.independentWitnesses = 1;
writeFileSync(join(fixture, 'release-state.json'), JSON.stringify(release));
writeFileSync(join(fixture, 'ATTESTATIONS.md'), '> **Count: 1.**\n');

try {
  execFileSync(process.execPath, [join(root, 'scripts', 'validate-adoption-program.mjs'), fixture], { stdio: ['ignore', 'pipe', 'pipe'] });
  throw new Error('validator accepted author-operated evidence as independent');
} catch (error) {
  if (error.status !== 1 || !String(error.stderr).includes('cannot be accepted-independent')) throw error;
}
process.stdout.write('adoption-program self-test: PASS (author-operated evidence rejected as independent)\n');
