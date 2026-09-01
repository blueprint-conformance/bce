/**
 * The served-runtime observation ingest seam (relocated from cli.ts per the corpus-expansion
 * design §4 + adversarial-review FIX 3).
 *
 * WHY A LIBRARY MODULE: the recall harness (tests/recall-e2e-proof.test.ts) must merge a
 * behavior fixture's recorded probe artifact (`observations.json`) through the SAME fail-closed
 * validated path the CLI uses — never a test-local copy. The CLI's `loadObservations` was
 * module-private and every validation failure called `die()` (stderr `::error::` + process.exit)
 * — CLI-only exit semantics that must NOT leak into a library import (a malformed
 * observations.json would process.exit the vitest worker). So:
 *
 *   - THIS module exports a THROWING `loadObservations` (ObservationsValidationError carries the
 *     exact message `die()` previously printed);
 *   - cli.ts catches and `die()`s with the IDENTICAL message + exit code (CLI bytes preserved —
 *     observations-merge.test.ts's CLI fail-closed cases are the oracle);
 *   - the harness gets the importable throwing path.
 *
 * Same fail-closed validation, relocated seam — zero behavior change on the CLI surface.
 *
 * The file is a provenance envelope. Its binding must match the evaluated revision, scanned
 * source-tree digest, extracted graph digest, blueprint-pinned probe/stimulus digests, and
 * environment identity. The probe definition and stimulus set are included and re-hashed.
 * Each nested observation has the exact shape report.ts dereferences:
 *   id:   `behavior:<ref>:<stimulusId>`   (MUST startWith "behavior:")
 *   type: "behaviorObservation"
 *   path: "<outputHash>|<oracleSatisfied 0|1>"   (exactly one '|', 2nd segment is '0' or '1')
 *   line: 1
 * Fail-closed: a missing file, non-JSON, legacy bare array, binding mismatch, or malformed node THROWS (never a silent
 * partial merge — a dropped observation could turn a RED constant-function into a false GREEN).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { ArchitectureGraph, ObservedComponent } from './graph.js';

export interface ObservationBinding {
  revision: string;
  sourceTreeHash: string;
  artifactHash: string;
}

export interface ObservationExpectation extends ObservationBinding {
  probeDefinitionHash: string;
  stimulusSetHash: string;
  environmentId: string;
}

const HEX_256 = /^[0-9a-f]{64}$/;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

/** Bind observations to the exact source set and extracted artifact that evaluation will use. */
export function observationBinding(repoDir: string, graph: ArchitectureGraph): ObservationBinding {
  const scanned = graph.coverage.scannedFiles;
  if (!scanned) reject(`cannot bind observations: extractor did not report coverage.scannedFiles`);
  const root = fs.realpathSync(repoDir);
  const tree = createHash('sha256');
  for (const rel of [...scanned].sort()) {
    const abs = fs.realpathSync(path.resolve(root, rel));
    if (abs !== root && !abs.startsWith(`${root}${path.sep}`)) {
      reject(`cannot bind observations: scanned file escapes repository: ${rel}`);
    }
    tree.update(rel).update('\0').update(fs.readFileSync(abs)).update('\0');
  }
  return {
    revision: graph.ctRepoRevision,
    sourceTreeHash: tree.digest('hex'),
    artifactHash: sha256Canonical(graph),
  };
}

/** Thrown on any observations-file validation failure. `message` = the exact CLI error text. */
export class ObservationsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObservationsValidationError';
  }
}

function reject(msg: string): never {
  throw new ObservationsValidationError(msg);
}

/**
 * Read a served-runtime observation envelope, verify its provenance binding, and return the
 * validated behaviorObservation nodes. THROWS on any mismatch or malformation.
 */
export function loadObservations(p: string, expected: ObservationExpectation): ObservedComponent[] {
  if (!p || !fs.existsSync(p)) reject(`--observations file not found: ${p}`);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    reject(`--observations is not valid JSON: ${(e as Error).message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    reject(`--observations must be a provenance envelope object.`);
  }
  const envelope = raw as Record<string, unknown>;
  if (envelope.schemaVersion !== '1') reject(`--observations schemaVersion must be "1".`);
  const binding = envelope.binding as Record<string, unknown> | undefined;
  if (!binding || typeof binding !== 'object') reject(`--observations.binding must be an object.`);
  const exact = (key: keyof ObservationExpectation): void => {
    if (binding[key] !== expected[key]) {
      reject(`--observations binding mismatch for ${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(binding[key])}.`);
    }
  };
  exact('revision');
  exact('sourceTreeHash');
  exact('artifactHash');
  exact('probeDefinitionHash');
  exact('stimulusSetHash');
  exact('environmentId');
  for (const key of ['sourceTreeHash', 'artifactHash', 'probeDefinitionHash', 'stimulusSetHash'] as const) {
    if (typeof binding[key] !== 'string' || !HEX_256.test(binding[key] as string)) reject(`--observations.binding.${key} must be a lowercase sha256.`);
  }
  if (sha256Canonical(envelope.probeDefinition) !== binding.probeDefinitionHash) {
    reject(`--observations probeDefinition does not match probeDefinitionHash.`);
  }
  if (!Array.isArray(envelope.stimuli) || sha256Canonical(envelope.stimuli) !== binding.stimulusSetHash) {
    reject(`--observations stimuli do not match stimulusSetHash.`);
  }
  const collector = envelope.collector as Record<string, unknown> | undefined;
  if (!collector || typeof collector.name !== 'string' || !collector.name || typeof collector.version !== 'string' || !collector.version) {
    reject(`--observations.collector must name a collection tool and version.`);
  }
  const rawObservations = envelope.observations;
  if (!Array.isArray(rawObservations)) reject(`--observations.observations must be a JSON array.`);
  const out: ObservedComponent[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rawObservations.length; i++) {
    const n = rawObservations[i] as Record<string, unknown> | null;
    const where = `--observations[${i}]`;
    if (!n || typeof n !== 'object') reject(`${where}: not an object.`);
    const { id, type, path: nodePath, line } = n as {
      id?: unknown;
      type?: unknown;
      path?: unknown;
      line?: unknown;
    };
    if (typeof id !== 'string' || !id.startsWith('behavior:')) {
      reject(`${where}: id must be a string starting "behavior:<ref>:<stimulus>" (got ${JSON.stringify(id)}).`);
    }
    if (type !== 'behaviorObservation') {
      reject(`${where}: type must be "behaviorObservation" (got ${JSON.stringify(type)}).`);
    }
    if (typeof nodePath !== 'string') {
      reject(`${where}: path must be "<outputHash>|<oracleSatisfied 0|1>" (got ${JSON.stringify(nodePath)}).`);
    }
    const segs = nodePath.split('|');
    if (segs.length !== 2 || segs[0] === '' || (segs[1] !== '0' && segs[1] !== '1')) {
      reject(`${where}: path must be exactly "<nonEmptyHash>|<0 or 1>" (got ${JSON.stringify(nodePath)}).`);
    }
    if (line !== 1) {
      reject(`${where}: line must be 1 (behaviorObservation nodes are line-1 pseudo-nodes; got ${JSON.stringify(line)}).`);
    }
    if (seen.has(id)) reject(`${where}: duplicate observation id ${JSON.stringify(id)}.`);
    seen.add(id);
    out.push({ id, type, path: nodePath, line });
  }
  return out;
}
