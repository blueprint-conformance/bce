import { createHash } from 'node:crypto';
import type { ArchitectureGraph } from './graph.js';
import { evaluate, stableStringify, type ComplianceReport } from './report.js';
import { parseBlueprint, type EngineeringBlueprint, type ExtractionProfile } from './schema.js';

const sha256 = (value: unknown): string => createHash('sha256').update(stableStringify(value)).digest('hex');
const detached = <T>(value: T): T => JSON.parse(stableStringify(value)) as T;

export interface EvidenceBundle {
  schemaVersion: '1';
  kind: 'BceEvidenceBundle';
  claim: 'self-contained-integrity-not-origin-authenticity';
  engine: { name: 'bce-engine'; version: string };
  environment: { node: string; platform: string; arch: string };
  invocation: { command: string; extractionProfile: ExtractionProfile };
  artifacts: { blueprint: EngineeringBlueprint; graph: ArchitectureGraph; report: ComplianceReport };
  hashes: { blueprint: string; graph: string; report: string; bundle: string };
}

type WithoutBundleHash = Omit<EvidenceBundle, 'hashes'> & { hashes: Omit<EvidenceBundle['hashes'], 'bundle'> };

export function createEvidenceBundle(args: {
  blueprint: EngineeringBlueprint;
  graph: ArchitectureGraph;
  report: ComplianceReport;
  engineVersion: string;
  command: string;
  extractionProfile: ExtractionProfile;
}): EvidenceBundle {
  // Detach the three documents: engine objects may share immutable array references, while the
  // persisted JSON documents do not. The bundle represents persisted bytes, not JS aliasing.
  const blueprint = detached(args.blueprint);
  const graph = detached(args.graph);
  const report = detached(args.report);
  const body: WithoutBundleHash = {
    schemaVersion: '1', kind: 'BceEvidenceBundle', claim: 'self-contained-integrity-not-origin-authenticity',
    engine: { name: 'bce-engine', version: args.engineVersion },
    environment: { node: process.versions.node, platform: process.platform, arch: process.arch },
    invocation: { command: args.command, extractionProfile: args.extractionProfile },
    artifacts: { blueprint, graph, report },
    hashes: { blueprint: sha256(blueprint), graph: sha256(graph), report: sha256(report) },
  };
  return { ...body, hashes: { ...body.hashes, bundle: sha256(body) } };
}

export interface EvidenceBundleVerification {
  valid: boolean;
  integrity: 'verified' | 'failed';
  authenticity: 'not-established';
  failures: string[];
}

/** Re-hash every artifact and independently re-evaluate blueprint + graph to reproduce the report. */
export function verifyEvidenceBundle(bundle: EvidenceBundle): EvidenceBundleVerification {
  const failures: string[] = [];
  try {
    if (bundle.kind !== 'BceEvidenceBundle' || bundle.schemaVersion !== '1') failures.push('unsupported bundle envelope');
    if (bundle.claim !== 'self-contained-integrity-not-origin-authenticity') failures.push('dishonest or unknown claim');
    let blueprint: EngineeringBlueprint | undefined;
    try { blueprint = parseBlueprint(bundle.artifacts.blueprint); } catch (e) { failures.push(`blueprint invalid: ${(e as Error).message}`); }
    if (sha256(bundle.artifacts.blueprint) !== bundle.hashes.blueprint) failures.push('blueprint hash mismatch');
    if (sha256(bundle.artifacts.graph) !== bundle.hashes.graph) failures.push('graph hash mismatch');
    if (sha256(bundle.artifacts.report) !== bundle.hashes.report) failures.push('report hash mismatch');
    const { bundle: ignored, ...artifactHashes } = bundle.hashes;
    void ignored;
    const body: WithoutBundleHash = { ...bundle, hashes: artifactHashes };
    if (sha256(body) !== bundle.hashes.bundle) failures.push('bundle hash mismatch');
    if (blueprint) {
      const reproduced = evaluate(blueprint, bundle.artifacts.graph, bundle.invocation.extractionProfile, bundle.artifacts.report.repo);
      if (stableStringify(reproduced) !== stableStringify(bundle.artifacts.report)) failures.push('report does not reproduce from bundled blueprint and graph');
    }
  } catch (e) {
    failures.push(`malformed bundle: ${(e as Error).message}`);
  }
  return { valid: failures.length === 0, integrity: failures.length === 0 ? 'verified' : 'failed', authenticity: 'not-established', failures };
}
