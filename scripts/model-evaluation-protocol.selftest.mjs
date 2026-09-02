#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), 'bce-model-protocol-'));
const trialsDir = join(scratch, 'trials');
mkdirSync(trialsDir);
const prereg = JSON.parse(readFileSync(join(root, 'research', 'model-evaluation-preregistration.json'), 'utf8'));
prereg.status = 'frozen-ready-not-run';
for (const harness of prereg.harnesses) {
  harness.clientVersion = `${harness.id}-client-1.0.0`;
  harness.clientArtifactSha256 = 'a'.repeat(64);
  harness.modelSnapshot = `${harness.id}-model-2026-09-02`;
}
const manifest = {
  schemaVersion: '1', status: 'sealed-ready', sealed: true, manifestSha256: null,
  repositories: Array.from({ length: 6 }, (_, i) => ({ id: `repo-${i}` })),
  tasks: Array.from({ length: 12 }, (_, i) => ({ id: `task-${i}`, repositoryId: `repo-${i % 6}` })),
  randomizedTrials: [],
};
let orderIndex = 0;
for (const harness of prereg.harnesses) {
  for (const arm of prereg.arms) {
    for (let replicate = 0; replicate < 30; replicate += 1) {
      const repositoryId = `repo-${replicate % 6}`;
      const taskId = `task-${replicate % 12}`;
      const trialId = `${harness.id}-${arm}-${replicate}`;
      const assignment = { trialId, harness: harness.id, arm, repositoryId, taskId, orderIndex: orderIndex++ };
      manifest.randomizedTrials.push(assignment);
      const bce = arm === 'bce-enabled';
      const row = {
        schemaVersion: '1', ...assignment,
        identity: { clientVersion: harness.clientVersion, clientArtifactSha256: harness.clientArtifactSha256, modelSnapshot: harness.modelSnapshot },
        configuration: { isolatedHome: true, userConfigImported: false, sharedCache: false, networkPolicy: 'fixtures-only', digestSha256: 'c'.repeat(64) },
        status: 'completed',
        outcomes: {
          architectureConformant: bce || replicate < 15,
          taskSuccessful: replicate < 27,
          policyMutation: bce && replicate === 0,
          skillLoaded: bce,
          mcpSelected: bce && replicate < 24,
          gateCalls: bce ? 2 : 0,
          agentIterations: 2,
          adjudicators: ['blind-a', 'blind-b'],
          locations: ['src/example.ts#L1'],
        },
        telemetry: { latencyMs: bce ? 1200 : 1000, inputTokens: 100, outputTokens: 20, cachedTokens: 0, costUsd: 0.01, unavailableReasons: {} },
        artifacts: { transcriptSha256: 'd'.repeat(64), patchSha256: 'e'.repeat(64), verdictSha256: 'f'.repeat(64) },
      };
      writeFileSync(join(trialsDir, `${trialId}.json`), JSON.stringify(row));
    }
  }
}
manifest.manifestSha256 = `sha256:${createHash('sha256').update(JSON.stringify({ ...manifest, manifestSha256: null })).digest('hex')}`;
const preregPath = join(scratch, 'prereg.json');
const manifestPath = join(scratch, 'manifest.json');
writeFileSync(preregPath, JSON.stringify(prereg));
writeFileSync(manifestPath, JSON.stringify(manifest));
const args = [join(root, 'scripts', 'analyze-model-evaluation.mjs'), '--trials', trialsDir, '--prereg', preregPath, '--manifest', manifestPath];
const output = execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const analysis = JSON.parse(output);
if (analysis.trials !== 240) throw new Error(`expected 240 trials, got ${analysis.trials}`);
if (analysis.harnesses.codex.arms['bce-enabled'].policyMutation.successes !== 1) throw new Error('policy mutation was not retained in the denominator');

manifest.tasks[0].id = 'tampered-task';
writeFileSync(manifestPath, JSON.stringify(manifest));
const tampered = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
if (tampered.status !== 1 || !tampered.stderr.includes('digest does not match')) throw new Error('analysis accepted a task manifest changed after sealing');
manifest.tasks[0].id = 'task-0';
writeFileSync(manifestPath, JSON.stringify(manifest));

const removed = manifest.randomizedTrials[0].trialId;
rmSync(join(trialsDir, `${removed}.json`));
const incomplete = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
if (incomplete.status !== 1 || !incomplete.stderr.includes('denominator mismatch')) throw new Error('analysis accepted a missing randomized trial');

const liveReadiness = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/research-readiness.ts', '--model-eval'], { cwd: root, encoding: 'utf8' });
if (liveReadiness.status !== 2 || !liveReadiness.stderr.includes('REFUSED')) throw new Error('unfrozen live model protocol did not refuse execution');
console.log('model-evaluation protocol self-test: PASS (240-trial analysis; policy mutation counted; post-seal tamper and missing trial rejected; live execution refused until frozen)');
