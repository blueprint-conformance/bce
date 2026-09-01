import * as fs from 'node:fs';
import * as path from 'node:path';

export const TEETH_WAIVER_RELPATH = path.join('.blueprints', 'teeth-waivers.json');

export interface TeethWaiver {
  blueprintRef: string;
  decision: 'accept-evaluator-refutable';
  reviewer: string;
  rationale: string;
  evidenceRef: string;
}

export class TeethWaiverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeethWaiverError';
  }
}

/** Read an exact, committed waiver. Unknown keys and malformed review records fail closed. */
export function readTeethWaiver(repoDir: string, blueprintRef: string): TeethWaiver {
  const p = path.join(repoDir, TEETH_WAIVER_RELPATH);
  if (!fs.existsSync(p)) throw new TeethWaiverError(`${TEETH_WAIVER_RELPATH} not found`);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    throw new TeethWaiverError(`${TEETH_WAIVER_RELPATH} is not valid JSON: ${(e as Error).message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TeethWaiverError(`${TEETH_WAIVER_RELPATH} must be an object`);
  const top = raw as Record<string, unknown>;
  if (Object.keys(top).some((k) => !['schemaVersion', 'waivers'].includes(k)) || top.schemaVersion !== '1' || !Array.isArray(top.waivers)) {
    throw new TeethWaiverError(`${TEETH_WAIVER_RELPATH} must contain only schemaVersion "1" and waivers[]`);
  }
  const matches = top.waivers.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x) && x.blueprintRef === blueprintRef);
  if (matches.length !== 1) throw new TeethWaiverError(`expected exactly one waiver for ${blueprintRef}, found ${matches.length}`);
  const w = matches[0];
  if (!w) throw new TeethWaiverError(`waiver for ${blueprintRef} disappeared during validation`);
  const keys = ['blueprintRef', 'decision', 'reviewer', 'rationale', 'evidenceRef'];
  if (Object.keys(w).some((k) => !keys.includes(k))) throw new TeethWaiverError(`waiver for ${blueprintRef} has unknown keys`);
  if (w.decision !== 'accept-evaluator-refutable') throw new TeethWaiverError(`waiver for ${blueprintRef} has invalid decision`);
  for (const key of ['reviewer', 'rationale', 'evidenceRef'] as const) {
    if (typeof w[key] !== 'string' || w[key].trim().length < (key === 'rationale' ? 20 : 3)) {
      throw new TeethWaiverError(`waiver for ${blueprintRef} requires a substantive ${key}`);
    }
  }
  return w as unknown as TeethWaiver;
}
