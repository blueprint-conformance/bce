#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { bindVerifiedFoundryRegistry, loadEvidenceClaims } from './lib/evidence-claims.mjs';
import { verifyStudyRegistry } from './lib/evidence-foundry-v3.mjs';

const rootArg = process.argv.indexOf('--root');
const root = resolve(rootArg >= 0 ? process.argv[rootArg + 1] ?? '' : '.');

try {
  const evidence = loadEvidenceClaims(root);
  let foundryRegistryReport;
  try {
    foundryRegistryReport = verifyStudyRegistry({
      root,
      indexPath: evidence.foundryStudy.registry,
      stageId: evidence.foundryStudy.primaryStage.stageId,
    });
  } catch (error) {
    throw new Error(`claim-evidence: Evidence Foundry v3 full registry and result verification refused: ${error.message}`);
  }
  bindVerifiedFoundryRegistry(evidence, foundryRegistryReport);
  const affirmativeOverclaims = [
    /\bBCE\s+(?:makes|made)\s+agents\s+more\s+successful\b/gi,
    /\bBCE\s+(?:improves|improved)\s+coding-agent\s+outcomes\b/gi,
    /\bBCE\s+(?:reduces|reduced)\s+(?:agent\s+)?(?:cost|latency|iteration\s+count)\b/gi,
    /\bBCE\s+(?:prevents|prevented)\s+policy\s+manipulation\b/gi,
    /\bBCE\s+(?:is|was)\s+proven\s+(?:effective|safer)\b/gi,
  ];
  const negation = /\b(?:no|not|never|cannot|can't|does not|do not|did not|unestablished|ineligible|without)\b/i;
  const obsoleteForwardStudyClaims = [
    /\bcanonical\s+(?:four-cell,\s+baseline\/BCE\s+)?600-(?:attempt|trial)\s+confirmatory\b/gi,
    /\bheld-out,\s+provider-identified\s+600-trial\s+confirmatory study\b/gi,
    /\bcanonical controlled coding-agent study\b[^.]{0,240}\bresearch:model-eval-readiness\b/gis,
    /\b(?:honest\s+)?next\s+(?:causal\s+)?efficacy\s+step\b[^.]{0,240}\b(?:600(?:-|\s+)(?:attempt|trial)s?|four[- ]cell|75\s+tasks?\s+per\s+arm)\b/gis,
    /\bthe\s+confirmatory\s+matrix\s+uses\s+75\s+tasks?\s+per\s+arm\b/gi,
  ];
  const failures = [];
  const immutablePilotArchive = /^research\/model-evaluation\/pilots\/accelerated-v[1-6]\//;
  const publicFiles = new Set(['README.md', 'STATUS.md', 'PRODUCT.md', 'llms.txt']);
  const collectMarkdown = (path) => {
    if (!existsSync(path)) return;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) collectMarkdown(join(path, entry));
    } else if (path.endsWith('.md')) publicFiles.add(relative(root, path));
  };
  collectMarkdown(join(root, 'docs'));
  collectMarkdown(join(root, 'research'));
  for (const path of [...publicFiles].sort()) {
    const content = readFileSync(resolve(root, path), 'utf8');
    for (const pattern of affirmativeOverclaims) {
      for (const match of content.matchAll(pattern)) {
        const before = content.slice(0, match.index);
        const sentenceStart = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'), before.lastIndexOf('\n\n')) + 1;
        const tail = content.slice(match.index);
        const stops = [tail.indexOf('.'), tail.indexOf('!'), tail.indexOf('?'), tail.indexOf('\n\n')].filter((value) => value >= 0);
        const sentenceEnd = match.index + (stops.length > 0 ? Math.min(...stops) + 1 : tail.length);
        const sentence = content.slice(sentenceStart, sentenceEnd);
        if (!negation.test(sentence)) {
          const line = before.split(/\r?\n/).length;
          failures.push(`${path}:${line}: unqualified product-efficacy claim`);
        }
      }
    }
    if (!immutablePilotArchive.test(path)) {
      for (const pattern of obsoleteForwardStudyClaims) {
        for (const match of content.matchAll(pattern)) {
          const line = content.slice(0, match.index).split(/\r?\n/).length;
          failures.push(`${path}:${line}: obsolete v2 study presented as the current forward study`);
        }
      }
    }
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));
  const foundryReadiness = evidence.foundryStudy.ready ? 'ready' : 'not-ready';
  const foundryClaims = evidence.foundryStudy.currentClaimClasses.join(',');
  process.stdout.write(
    `evidence-claim-policy: PASS (${evidence.matrix.claims.length} claims; v6 ${evidence.summary.verifiedTrials}/` +
    `${evidence.summary.runDisposition.plannedTrials} retained; v3 ${evidence.foundryStudy.lifecycle}/${foundryReadiness}/` +
    `${evidence.foundryStudy.primaryStage.retainedAttempts}-attempt primary; claims ${foundryClaims}; result ${evidence.study.resultSha256})\n`,
  );
} catch (error) {
  process.stderr.write(`evidence-claim-policy: FAIL\n- ${String(error.message).replaceAll('\n', '\n- ')}\n`);
  process.exit(1);
}
