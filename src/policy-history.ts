import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseBlueprint, type EngineeringBlueprint } from './schema.js';
import { stableStringify } from './report.js';

export const POLICY_HISTORY_RELPATH = path.join('.blueprints', 'POLICY-HISTORY.jsonl');

export type PolicyOperation = 'ratify' | 'amend';
export interface PolicyHistoryEntry {
  schemaVersion: '1';
  operation: PolicyOperation;
  blueprintId: string;
  fromRef: string;
  toRef: string;
  reviewer: string;
  reviewerType: 'human-asserted';
  rationale: string;
  recordedAt: string;
  compatibility: 'initial-ratification' | 'compatible' | 'breaking' | 'tightening' | 'weakening';
  proof: 'extractor-real' | 'reviewed-evaluator-waiver';
}

export class PolicyHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyHistoryError';
  }
}

export interface ReviewInput {
  reviewer: string;
  rationale: string;
  recordedAt: string;
  humanReviewer: boolean;
  acceptWeakening?: boolean;
}

function validateReview(review: ReviewInput): void {
  if (!review.humanReviewer) throw new PolicyHistoryError('policy transition requires --human-reviewer attestation');
  if (review.reviewer.trim().length < 3) throw new PolicyHistoryError('policy transition requires --reviewer identity');
  if (review.rationale.trim().length < 20) throw new PolicyHistoryError('policy transition requires substantive --rationale (>=20 chars)');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(review.recordedAt)) {
    throw new PolicyHistoryError('--recorded-at must be an explicit UTC ISO-8601 timestamp');
  }
}

function semverParts(v: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new PolicyHistoryError(`invalid semver: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function semverGreater(a: string, b: string): boolean {
  const aa = semverParts(a);
  const bb = semverParts(b);
  return aa[0] !== bb[0] ? aa[0] > bb[0] : aa[1] !== bb[1] ? aa[1] > bb[1] : aa[2] > bb[2];
}

function bumpPatch(v: string): string {
  const [major, minor, patch] = semverParts(v);
  return `${major}.${minor}.${patch + 1}`;
}

function policyTarget(repoDir: string, blueprintPath: string): string {
  const root = fs.realpathSync(repoDir);
  const policyRoot = path.resolve(root, '.blueprints');
  const target = fs.realpathSync(blueprintPath);
  if (target !== policyRoot && !target.startsWith(`${policyRoot}${path.sep}`)) {
    throw new PolicyHistoryError('policy transitions may modify only committed files under .blueprints/');
  }
  return target;
}

function appendHistory(repoDir: string, entry: PolicyHistoryEntry): void {
  const p = path.join(repoDir, POLICY_HISTORY_RELPATH);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(JSON.parse(stableStringify(entry))) + '\n');
}

export function ratifyBlueprint(args: {
  repoDir: string;
  blueprintPath: string;
  review: ReviewInput;
  proof: PolicyHistoryEntry['proof'];
}): { blueprint: EngineeringBlueprint; entry: PolicyHistoryEntry } {
  validateReview(args.review);
  const target = policyTarget(args.repoDir, args.blueprintPath);
  const current = parseBlueprint(JSON.parse(fs.readFileSync(target, 'utf8')));
  if (current.metadata.status !== 'draft' && current.metadata.status !== 'proposed') {
    throw new PolicyHistoryError(`ratify requires draft/proposed status, got ${current.metadata.status}`);
  }
  const fromRef = `${current.metadata.id}@${current.metadata.version}`;
  const blueprint = parseBlueprint({
    ...current,
    metadata: { ...current.metadata, version: bumpPatch(current.metadata.version), status: 'approved' },
  });
  const toRef = `${blueprint.metadata.id}@${blueprint.metadata.version}`;
  const entry: PolicyHistoryEntry = {
    schemaVersion: '1', operation: 'ratify', blueprintId: blueprint.metadata.id, fromRef, toRef,
    reviewer: args.review.reviewer.trim(), reviewerType: 'human-asserted', rationale: args.review.rationale.trim(),
    recordedAt: args.review.recordedAt, compatibility: 'initial-ratification', proof: args.proof,
  };
  fs.writeFileSync(target, stableStringify(blueprint));
  appendHistory(args.repoDir, entry);
  const adoptionPath = path.join(args.repoDir, '.bce-adoption.json');
  if (fs.existsSync(adoptionPath)) {
    const adoption = JSON.parse(fs.readFileSync(adoptionPath, 'utf8')) as Record<string, unknown>;
    adoption.ratified = true;
    adoption.state = 'ratified-advisory';
    adoption.blueprintRef = toRef;
    fs.writeFileSync(adoptionPath, stableStringify(adoption));
  }
  return { blueprint, entry };
}

export function amendBlueprint(args: {
  repoDir: string;
  blueprintPath: string;
  replacementPath: string;
  review: ReviewInput;
  compatibility: Exclude<PolicyHistoryEntry['compatibility'], 'initial-ratification'>;
  proof: PolicyHistoryEntry['proof'];
}): { blueprint: EngineeringBlueprint; entry: PolicyHistoryEntry } {
  validateReview(args.review);
  if (args.compatibility === 'weakening' && !args.review.acceptWeakening) {
    throw new PolicyHistoryError('weakening requires explicit --accept-weakening attestation');
  }
  const target = policyTarget(args.repoDir, args.blueprintPath);
  const current = parseBlueprint(JSON.parse(fs.readFileSync(target, 'utf8')));
  const replacement = parseBlueprint(JSON.parse(fs.readFileSync(args.replacementPath, 'utf8')));
  if (current.metadata.status !== 'approved' || replacement.metadata.status !== 'approved') {
    throw new PolicyHistoryError('amend requires both current and replacement blueprints to be approved');
  }
  if (replacement.metadata.id !== current.metadata.id) throw new PolicyHistoryError('replacement blueprint id must match current id');
  if (!semverGreater(replacement.metadata.version, current.metadata.version)) {
    throw new PolicyHistoryError(`replacement version ${replacement.metadata.version} must be greater than ${current.metadata.version}`);
  }
  const fromRef = `${current.metadata.id}@${current.metadata.version}`;
  const toRef = `${replacement.metadata.id}@${replacement.metadata.version}`;
  const entry: PolicyHistoryEntry = {
    schemaVersion: '1', operation: 'amend', blueprintId: current.metadata.id, fromRef, toRef,
    reviewer: args.review.reviewer.trim(), reviewerType: 'human-asserted', rationale: args.review.rationale.trim(),
    recordedAt: args.review.recordedAt, compatibility: args.compatibility, proof: args.proof,
  };
  fs.writeFileSync(target, stableStringify(replacement));
  appendHistory(args.repoDir, entry);
  return { blueprint: replacement, entry };
}

export function readPolicyHistory(repoDir: string): PolicyHistoryEntry[] {
  const p = path.join(repoDir, POLICY_HISTORY_RELPATH);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((line, i) => {
    try { return JSON.parse(line) as PolicyHistoryEntry; }
    catch (e) { throw new PolicyHistoryError(`${POLICY_HISTORY_RELPATH} line ${i + 1} invalid: ${(e as Error).message}`); }
  });
}
