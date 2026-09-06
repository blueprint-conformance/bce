#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonical,
  registryReleaseEvidenceRefusals,
  resolveRegularFileInside,
  sha256Bytes,
  validateProtocolV3,
} from './lib/evidence-foundry-v3.mjs';

const root = realpathSync(resolve(fileURLToPath(new URL('..', import.meta.url))));
const valueAfter = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const protocolPath = valueAfter('--protocol') ?? 'research/model-evaluation/studies/evidence-foundry-v3/protocol.json';
const stageId = valueAfter('--stage');
const outPath = valueAfter('--out');

function refuse(message) {
  process.stderr.write(`result-anchor: REFUSED — ${message}\n`);
  process.exit(2);
}

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== 'blueprint-conformance/bce' ||
    !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') || !/^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT ?? '') ||
    !/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA ?? '')) {
  refuse('the result anchor may be produced only by an identified blueprint-conformance/bce GitHub Actions run');
}
if (!stageId || !outPath || isAbsolute(outPath) || outPath.includes('\\') || outPath.split('/').includes('..')) {
  refuse('usage: --stage STAGE --out REPOSITORY_RELATIVE_JSON');
}

try {
  const protocol = JSON.parse(readFileSync(resolveRegularFileInside(root, protocolPath, 'v3 protocol'), 'utf8'));
  validateProtocolV3(root, protocol);
  const stage = protocol.stages.find((entry) => entry.id === stageId);
  if (!stage || stage.lifecycle !== 'running' || stage.lifecycleEvidence?.disposition !== 'complete-awaiting-anchor' ||
      stage.resultEvidence !== null || !stage.executionBundlePath) {
    refuse('target stage must be registered with complete replayable lifecycle evidence awaiting only its external anchor');
  }
  const resultsPath = stage.lifecycleEvidence.resultsPath;
  const releaseRefusals = registryReleaseEvidenceRefusals(root, protocol.releaseBinding);
  if (releaseRefusals.length > 0) refuse(`release registry evidence refused: ${releaseRefusals.join('; ')}`);
  const executionProtocol = JSON.parse(readFileSync(resolveRegularFileInside(
    root, `${stage.executionBundlePath}/protocol.v2.json`, 'stage execution protocol',
  ), 'utf8'));
  const summaryPath = resolveRegularFileInside(root, `${resultsPath}/summary.json`, 'public result summary');
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const publicVerifier = resolve(root, 'scripts', 'verify-model-evaluation-public.mjs');
  const replay = spawnSync(process.execPath, [publicVerifier, '--bundle', resolve(root, stage.executionBundlePath), '--results', resolve(root, resultsPath)], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (replay.status !== 0) refuse(`public result replay failed: ${String(replay.stderr || replay.stdout).trim()}`);
  const expectedTrials = protocol.taskPopulation.pairsPerCell * protocol.arms.length;
  if (summary.runDisposition?.status !== 'complete' || summary.verifiedTrials !== expectedTrials ||
      summary.runDisposition?.plannedTrials !== expectedTrials || summary.runDisposition?.committedTrials !== expectedTrials ||
      !/^[0-9a-f]{64}$/.test(summary.resultSha256 ?? '') || !/^[0-9a-f]{64}$/.test(summary.publicReplay?.checkpointHeadSha256 ?? '')) {
    refuse('public result does not retain the full preregistered denominator and checkpoint head');
  }
  const source = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const resultSourceCommit = source.status === 0 ? source.stdout.trim() : '';
  if (!/^[0-9a-f]{40}$/.test(resultSourceCommit) || resultSourceCommit !== process.env.GITHUB_SHA) {
    refuse('result source commit must equal the exact GitHub workflow commit');
  }
  const anchor = {
    schemaVersion: '2',
    anchorKind: 'sigstore-github-oidc-result-anchor',
    studyId: protocol.studyId,
    executionStudyId: executionProtocol.studyId,
    stageId: stage.id,
    resultSha256: summary.resultSha256,
    checkpointHeadSha256: summary.publicReplay.checkpointHeadSha256,
    releasePackageArtifactSha256: protocol.releaseBinding.packageArtifactSha256,
    releaseRegistryVerificationSha256: protocol.releaseBinding.registryVerification.recordSha256,
    resultSourceCommit,
    anchorWorkflowCommit: process.env.GITHUB_SHA,
    operatorModel: 'solo-maintainer-machine-adjudicated',
    operatorIndependence: 'author-controlled-not-independent',
    publicUrl: `https://github.com/blueprint-conformance/bce/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${process.env.GITHUB_RUN_ATTEMPT}`,
    anchoredAt: new Date().toISOString(),
    anchorSha256: null,
  };
  anchor.anchorSha256 = sha256Bytes(JSON.stringify(canonical(anchor)));
  const output = resolve(root, outPath);
  if (!output.startsWith(`${root}${sep}`) || relative(root, output).split(sep).includes('..')) refuse('output escapes the repository');
  writeFileSync(output, `${JSON.stringify(anchor, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ output: relative(root, output).split(sep).join('/'), anchorSha256: sha256Bytes(readFileSync(output)) })}\n`);
} catch (error) {
  refuse(error.message);
}
