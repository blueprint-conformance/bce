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
 * Validated shape (the exact contract report.ts's behavioralInvariant grading dereferences):
 *   id:   `behavior:<ref>:<stimulusId>`   (MUST startWith "behavior:")
 *   type: "behaviorObservation"
 *   path: "<outputHash>|<oracleSatisfied 0|1>"   (exactly one '|', 2nd segment is '0' or '1')
 *   line: 1
 * Fail-closed: a missing file, non-JSON, non-array, or ANY malformed node THROWS (never a silent
 * partial merge — a dropped observation could turn a RED constant-function into a false GREEN).
 */
import * as fs from 'node:fs';
import type { ObservedComponent } from './graph.js';

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
 * Read a served-runtime probe's behaviorObservation nodes from a JSON file and validate each to
 * the ObservedComponent behaviorObservation shape. THROWS ObservationsValidationError on any
 * malformation (the caller decides the failure surface: cli.ts die()s; a test asserts).
 */
export function loadObservations(p: string): ObservedComponent[] {
  if (!p || !fs.existsSync(p)) reject(`--observations file not found: ${p}`);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    reject(`--observations is not valid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(raw)) {
    reject(`--observations must be a JSON array of behaviorObservation nodes (got ${typeof raw}).`);
  }
  const out: ObservedComponent[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const n = raw[i] as Record<string, unknown> | null;
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
