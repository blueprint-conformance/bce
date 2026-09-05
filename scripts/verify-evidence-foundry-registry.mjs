#!/usr/bin/env node
import { resolve } from 'node:path';
import { EvidenceFoundryRefusal, verifyStudyRegistry } from './lib/evidence-foundry-v3.mjs';

function parseArgs(argv) {
  const options = { root: process.cwd(), indexPath: 'research/model-evaluation/studies/index.v3.json', requireReady: false, json: false, stageId: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') {
      if (!argv[index + 1]) throw new EvidenceFoundryRefusal('--root requires a path');
      options.root = resolve(argv[++index]);
    } else if (argument === '--index') {
      if (!argv[index + 1]) throw new EvidenceFoundryRefusal('--index requires a repository-relative path');
      options.indexPath = argv[++index];
    } else if (argument === '--require-ready') options.requireReady = true;
    else if (argument === '--stage') {
      if (!argv[index + 1]) throw new EvidenceFoundryRefusal('--stage requires a stage ID');
      options.stageId = argv[++index];
    }
    else if (argument === '--json') options.json = true;
    else throw new EvidenceFoundryRefusal(`unknown argument: ${argument}`);
  }
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const report = verifyStudyRegistry(options);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Evidence Foundry registry: VALID (${report.archives.length} immutable archives, ${report.studies.length} v3 study)`);
    for (const study of report.studies) {
      console.log(`${study.studyId}: ${study.ready ? 'READY' : 'NOT READY'}; scope=${study.readinessScope}; lifecycle=${study.lifecycle}; claims=${study.claimClasses.join(',')}`);
      for (const blocker of study.blockers) console.log(`  - ${blocker}`);
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Evidence Foundry registry: REFUSED\n${message}`);
  process.exit(error instanceof EvidenceFoundryRefusal ? error.exitCode : 2);
}
