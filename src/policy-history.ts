import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseBlueprint, type EngineeringBlueprint } from './schema.js';
import { stableStringify } from './report.js';
import { reviewDigest } from './review.js';
import { resolveMode, formatGraduationRecord, formatModeConfig, readGraduationRecord, MODE_CONFIG_BASENAME, GRADUATION_RECORD_RELPATH, type GateMode } from './mode.js';

export const POLICY_HISTORY_RELPATH = path.join('.blueprints', 'POLICY-HISTORY.jsonl');
export const TRANSITION_LOCK_BASENAME = '.bce-policy-transition.lock';
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

export type PolicyOperation = 'ratify' | 'amend';
export interface PolicyReviewEvidence {
  packetDigest: string;
  decisionDigest: string;
  candidateDigest: string;
  baseDigest: string | null;
  repositoryRevision: string;
  worktreeDigest: string;
}

export interface PolicyHistoryEntry {
  schemaVersion: '1';
  operation: PolicyOperation;
  blueprintId: string;
  fromRef: string;
  toRef: string;
  reviewer: string;
  reviewerType: 'human-asserted' | 'scm-authenticated';
  reviewerAuthentication?: {
    reviewMode?: 'self-ratified' | undefined;
    method: 'scm' | 'sso';
    issuer: string;
    subject: string;
    assertionDigest: string;
    reference: string;
  };
  reviewEvidence?: PolicyReviewEvidence;
  rationale: string;
  recordedAt: string;
  compatibility: 'initial-ratification' | 'compatible' | 'breaking' | 'tightening' | 'weakening';
  proof: 'extractor-real' | 'reviewed-evaluator-waiver';
  outputDigest?: string;
}

export class PolicyHistoryError extends Error {
  readonly preserveTransitionLock: boolean;

  constructor(message: string, preserveTransitionLock = false) {
    super(message);
    this.name = 'PolicyHistoryError';
    this.preserveTransitionLock = preserveTransitionLock;
  }
}

export interface ReviewInput {
  reviewer: string;
  rationale: string;
  recordedAt: string;
  authentication: NonNullable<PolicyHistoryEntry['reviewerAuthentication']>;
  evidence: PolicyReviewEvidence;
  acceptWeakening?: boolean;
}

function digest(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function validateReview(review: ReviewInput): void {
  if (review.reviewer.trim().length < 3) throw new PolicyHistoryError('policy transition requires authenticated reviewer identity');
  if (review.rationale.trim().length < 20) throw new PolicyHistoryError('policy transition requires substantive rationale (>=20 chars)');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(review.recordedAt)) {
    throw new PolicyHistoryError('review timestamp must be an explicit UTC ISO-8601 timestamp');
  }
  if (
    !['scm', 'sso'].includes(review.authentication.method) ||
    !review.authentication.issuer ||
    !review.authentication.subject ||
    !digest(review.authentication.assertionDigest) ||
    !/^https:\/\//.test(review.authentication.reference)
  ) throw new PolicyHistoryError('SCM reviewer authentication metadata is invalid');
  const evidence = review.evidence;
  if (
    !digest(evidence.packetDigest) || !digest(evidence.decisionDigest) ||
    !digest(evidence.candidateDigest) || (evidence.baseDigest !== null && !digest(evidence.baseDigest)) ||
    !digest(evidence.worktreeDigest) || !evidence.repositoryRevision
  ) throw new PolicyHistoryError('policy review evidence binding is invalid');
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

function inside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function assertSafeAncestors(root: string, target: string, label: string): void {
  if (!inside(root, target)) throw new PolicyHistoryError(`${label} escapes the repository`);
  let cursor = root;
  for (const segment of path.relative(root, target).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) continue;
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new PolicyHistoryError(`${label} contains a symbolic link: ${cursor}`);
    if (!inside(root, fs.realpathSync(cursor))) throw new PolicyHistoryError(`${label} resolves outside the repository`);
  }
}

function ensurePolicyRoot(root: string): string {
  const policyRoot = path.join(root, '.blueprints');
  assertSafeAncestors(root, policyRoot, 'policy directory');
  if (!fs.existsSync(policyRoot)) fs.mkdirSync(policyRoot, { mode: 0o700 });
  const stat = fs.lstatSync(policyRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(policyRoot) !== policyRoot) {
    throw new PolicyHistoryError('policy directory must be a real in-repository directory');
  }
  return policyRoot;
}

function safeAbsolute(root: string, input: string, label: string): string {
  const requested = path.isAbsolute(input) ? path.resolve(input) : path.resolve(root, input);
  if (!fs.existsSync(requested)) throw new PolicyHistoryError(`${label} does not exist`);
  if (fs.lstatSync(requested).isSymbolicLink()) throw new PolicyHistoryError(`${label} must not be a symbolic link`);
  const target = fs.realpathSync(requested);
  assertSafeAncestors(root, target, label);
  return target;
}

function openRegular(target: string, writable: boolean, label: string): number {
  try {
    const fd = fs.openSync(target, (writable ? fs.constants.O_RDWR : fs.constants.O_RDONLY) | NOFOLLOW);
    if (!fs.fstatSync(fd).isFile() || (writable && fs.fstatSync(fd).nlink !== 1)) {
      fs.closeSync(fd);
      throw new PolicyHistoryError(`${label} must be a regular file`);
    }
    return fd;
  } catch (error) {
    if (error instanceof PolicyHistoryError) throw error;
    throw new PolicyHistoryError(`${label} cannot be opened safely: ${(error as Error).message}`);
  }
}

function readFd(fd: number, label: string): string {
  const before = fs.fstatSync(fd);
  const bytes = Buffer.alloc(before.size);
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
    if (count === 0) break;
    offset += count;
  }
  const after = fs.fstatSync(fd);
  if (offset !== bytes.length || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new PolicyHistoryError(`${label} changed while it was being read`);
  }
  return bytes.toString('utf8');
}

function parseRawBlueprint(raw: string, label: string, requireCanonical: boolean): EngineeringBlueprint {
  let blueprint: EngineeringBlueprint;
  try { blueprint = parseBlueprint(JSON.parse(raw)); }
  catch (error) { throw new PolicyHistoryError(`${label} is invalid: ${(error as Error).message}`); }
  if (requireCanonical && raw !== stableStringify(blueprint)) throw new PolicyHistoryError(`${label} bytes must be canonical`);
  return blueprint;
}

function writeFd(fd: number, content: string): void {
  const bytes = Buffer.from(content, 'utf8');
  fs.ftruncateSync(fd, 0);
  let offset = 0;
  while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset, offset);
  fs.fsyncSync(fd);
}

function sameOpenFile(target: string, fd: number): boolean {
  try {
    const pathStat = fs.lstatSync(target);
    const fdStat = fs.fstatSync(fd);
    return !pathStat.isSymbolicLink() && pathStat.dev === fdStat.dev && pathStat.ino === fdStat.ino;
  } catch {
    return false;
  }
}

function acquireLock(policyRoot: string): { fd: number; path: string } {
  const lockPath = path.join(policyRoot, TRANSITION_LOCK_BASENAME);
  try {
    const fd = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600);
    fs.writeSync(fd, `${JSON.stringify({ schemaVersion: '1', state: 'transition-in-progress' })}\n`, undefined, 'utf8');
    fs.fsyncSync(fd);
    return { fd, path: lockPath };
  } catch {
    throw new PolicyHistoryError('another policy transition is active or a stale transition lock exists');
  }
}

function releaseLock(lock: { fd: number; path: string }): void {
  const same = sameOpenFile(lock.path, lock.fd);
  fs.closeSync(lock.fd);
  if (!same) throw new PolicyHistoryError('policy transition lock changed; gate remains blocked for attended recovery', true);
  fs.unlinkSync(lock.path);
}

function preserveLock(lock: { fd: number; path: string }): void {
  fs.closeSync(lock.fd);
}

function historyEntry(
  operation: PolicyOperation,
  blueprintId: string,
  fromRef: string,
  toRef: string,
  compatibility: PolicyHistoryEntry['compatibility'],
  review: ReviewInput,
  proof: PolicyHistoryEntry['proof'],
): PolicyHistoryEntry {
  return {
    schemaVersion: '1', operation, blueprintId, fromRef, toRef,
    reviewer: review.reviewer.trim(), reviewerType: 'scm-authenticated',
    reviewerAuthentication: review.authentication, reviewEvidence: review.evidence,
    rationale: review.rationale.trim(), recordedAt: review.recordedAt, compatibility, proof,
  };
}

function executeTransition(args: {
  root: string;
  policyRoot: string;
  target: string;
  targetFd: number;
  priorTargetRaw?: string;
  output: string;
  entry: PolicyHistoryEntry;
  adoption?: AdoptionUpdate;
}): void {
  const historyPath = path.join(args.policyRoot, 'POLICY-HISTORY.jsonl');
  assertSafeAncestors(args.root, historyPath, 'policy history');
  const historyFd = fs.openSync(historyPath, fs.constants.O_RDWR | fs.constants.O_APPEND | fs.constants.O_CREAT | NOFOLLOW, 0o600);
  const historySize = fs.fstatSync(historyFd).size;
  try {
    writeFd(args.targetFd, args.output);
    if (!sameOpenFile(args.target, args.targetFd)) throw new PolicyHistoryError('policy target changed during transition');
    fs.writeSync(historyFd, `${JSON.stringify(JSON.parse(stableStringify(args.entry)))}\n`, undefined, 'utf8');
    fs.fsyncSync(historyFd);
    if (args.adoption) {
      args.adoption.fd ??= fs.openSync(args.adoption.path, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600);
      writeFd(args.adoption.fd, args.adoption.output);
      if (!sameOpenFile(args.adoption.path, args.adoption.fd)) throw new PolicyHistoryError('adoption record changed during transition');
    }
  } catch (error) {
    const rollbackFailures: string[] = [];
    try {
      if (!sameOpenFile(historyPath, historyFd)) throw new Error('history path changed');
      fs.ftruncateSync(historyFd, historySize);
      fs.fsyncSync(historyFd);
      if (fs.fstatSync(historyFd).size !== historySize) throw new Error('history size was not restored');
    } catch (rollbackError) {
      rollbackFailures.push(`history: ${(rollbackError as Error).message}`);
    }
    try {
      if (!sameOpenFile(args.target, args.targetFd)) throw new Error('policy target path changed');
      if (args.priorTargetRaw !== undefined) {
        writeFd(args.targetFd, args.priorTargetRaw);
        if (readFd(args.targetFd, 'policy rollback target') !== args.priorTargetRaw) throw new Error('policy bytes were not restored');
      } else {
        fs.unlinkSync(args.target);
        if (fs.existsSync(args.target)) throw new Error('new policy target was not removed');
      }
    } catch (rollbackError) {
      rollbackFailures.push(`policy: ${(rollbackError as Error).message}`);
    }
    if (args.adoption?.fd !== undefined) {
      try {
        if (!sameOpenFile(args.adoption.path, args.adoption.fd)) throw new Error('adoption path changed');
        if (args.adoption.prior === undefined) fs.unlinkSync(args.adoption.path);
        else {
          writeFd(args.adoption.fd, args.adoption.prior);
          if (readFd(args.adoption.fd, 'adoption rollback target') !== args.adoption.prior) throw new Error('adoption bytes were not restored');
        }
      } catch (rollbackError) {
        rollbackFailures.push(`adoption: ${(rollbackError as Error).message}`);
      }
    }
    if (rollbackFailures.length > 0) {
      throw new PolicyHistoryError(
        `policy transition failed and rollback is incomplete (${rollbackFailures.join('; ')}); transition lock retained for attended recovery`,
        true,
      );
    }
    if (error instanceof PolicyHistoryError) throw error;
    throw new PolicyHistoryError(`policy transition write failed: ${(error as Error).message}`);
  } finally {
    fs.closeSync(historyFd);
  }
}

export function ratifyBlueprint(args: {
  repoDir: string;
  blueprintPath: string;
  review: ReviewInput;
  proof: PolicyHistoryEntry['proof'];
  assertFresh: () => void;
  expectedCandidateDigest: string;
  expectedBaseDigest: string | null;
}): { blueprint: EngineeringBlueprint; entry: PolicyHistoryEntry } {
  validateReview(args.review);
  const root = fs.realpathSync(args.repoDir);
  const policyRoot = ensurePolicyRoot(root);
  const lock = acquireLock(policyRoot);
  let preserveTransitionLock = false;
  let sourceFd: number | undefined;
  let targetFd: number | undefined;
  let adoption: AdoptionUpdate | undefined;
  let newTarget = false;
  let target = '';
  try {
    const source = safeAbsolute(root, args.blueprintPath, 'ratification source');
    const quarantineRoot = path.join(root, '.bce', 'proposals');
    if (!inside(policyRoot, source) && !inside(quarantineRoot, source)) {
      throw new PolicyHistoryError('ratification source must be under .blueprints/ or .bce/proposals/');
    }
    sourceFd = openRegular(source, false, 'ratification source');
    let sourceRaw = readFd(sourceFd, 'ratification source');
    let current = parseRawBlueprint(sourceRaw, 'ratification source', true);
    if (reviewDigest(current) !== args.expectedCandidateDigest || args.review.evidence.candidateDigest !== args.expectedCandidateDigest) {
      throw new PolicyHistoryError('ratification source does not match the reviewed candidate digest');
    }
    const targets = fs.readdirSync(policyRoot).filter((name) => name.endsWith('.blueprint.json')).map((name) => safeAbsolute(root, path.join(policyRoot, name), 'policy target')).filter((file) => parseRawBlueprint(fs.readFileSync(file, 'utf8'), 'policy target', false).metadata.id === current.metadata.id);
    if (targets.length > 1) throw new PolicyHistoryError('ratification target blueprint identity is ambiguous');
    target = inside(policyRoot, source) ? source : targets[0] ?? path.join(policyRoot, `${current.metadata.id}.blueprint.json`);
    assertSafeAncestors(root, target, 'policy target');
    let priorTargetRaw: string | undefined;
    if (target === source) {
      fs.closeSync(sourceFd);
      sourceFd = undefined;
      targetFd = openRegular(target, true, 'policy target');
      sourceRaw = readFd(targetFd, 'policy target');
      current = parseRawBlueprint(sourceRaw, 'policy target', true);
      if (reviewDigest(current) !== args.expectedCandidateDigest) throw new PolicyHistoryError('policy target changed after review');
      priorTargetRaw = sourceRaw;
      if (args.expectedBaseDigest !== null) throw new PolicyHistoryError('in-place ratification requires a null reviewed base digest');
    } else if (fs.existsSync(target)) {
      targetFd = openRegular(target, true, 'existing policy target');
      priorTargetRaw = readFd(targetFd, 'existing policy target');
      const existing = parseRawBlueprint(priorTargetRaw, 'existing policy target', false);
      if (args.expectedBaseDigest === null || reviewDigest(existing) !== args.expectedBaseDigest) {
        throw new PolicyHistoryError('existing policy target does not match the reviewed base digest');
      }
      if (existing.metadata.id !== current.metadata.id || !['draft', 'proposed'].includes(existing.metadata.status)) {
        throw new PolicyHistoryError('ratification refuses to overwrite existing approved or unrelated policy');
      }
    } else {
      if (args.expectedBaseDigest !== null) throw new PolicyHistoryError('reviewed base is missing from the policy target');
      newTarget = true;
    }
    if (readFd((target === source ? targetFd : sourceFd)!, 'ratification source') !== sourceRaw) {
      throw new PolicyHistoryError('ratification source changed after review');
    }
    if (!['draft', 'proposed'].includes(current.metadata.status)) throw new PolicyHistoryError(`ratify requires draft/proposed status, got ${current.metadata.status}`);
    const fromRef = `${current.metadata.id}@${current.metadata.version}`;
    const blueprint = parseBlueprint({ ...current, metadata: { ...current.metadata, version: bumpPatch(current.metadata.version), status: 'approved' } });
    const toRef = `${blueprint.metadata.id}@${blueprint.metadata.version}`;
    const entry = historyEntry('ratify', blueprint.metadata.id, fromRef, toRef, 'initial-ratification', args.review, args.proof);
    entry.outputDigest = reviewDigest(blueprint);
    adoption = prepareAdoptionUpdate(root, fromRef, toRef, entry);
    args.assertFresh();
    if (targetFd === undefined) {
      targetFd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600);
    }
    executeTransition({ root, policyRoot, target, targetFd, ...(priorTargetRaw !== undefined ? { priorTargetRaw } : {}), output: stableStringify(blueprint), entry, ...(adoption ? { adoption } : {}) });
    newTarget = false;
    return { blueprint, entry };
  } catch (error) {
    preserveTransitionLock = error instanceof PolicyHistoryError && error.preserveTransitionLock;
    throw error;
  } finally {
    const removeNewTarget = newTarget && target !== '' && targetFd !== undefined && sameOpenFile(target, targetFd);
    if (adoption?.fd !== undefined) fs.closeSync(adoption.fd);
    if (sourceFd !== undefined) fs.closeSync(sourceFd);
    if (targetFd !== undefined) fs.closeSync(targetFd);
    if (removeNewTarget) fs.unlinkSync(target);
    if (preserveTransitionLock) preserveLock(lock);
    else releaseLock(lock);
  }
}

export function amendBlueprint(args: {
  repoDir: string;
  blueprintPath: string;
  replacementPath: string;
  review: ReviewInput;
  compatibility: Exclude<PolicyHistoryEntry['compatibility'], 'initial-ratification'>;
  proof: PolicyHistoryEntry['proof'];
  assertFresh: () => void;
  expectedCandidateDigest: string;
  expectedBaseDigest: string;
}): { blueprint: EngineeringBlueprint; entry: PolicyHistoryEntry } {
  validateReview(args.review);
  if (args.compatibility === 'weakening' && !args.review.acceptWeakening) throw new PolicyHistoryError('weakening requires explicit authenticated review acceptance');
  const root = fs.realpathSync(args.repoDir);
  const policyRoot = ensurePolicyRoot(root);
  const lock = acquireLock(policyRoot);
  let preserveTransitionLock = false;
  let targetFd: number | undefined;
  let replacementFd: number | undefined;
  let adoption: ReturnType<typeof prepareAdoptionUpdate>;
  try {
    const target = safeAbsolute(root, args.blueprintPath, 'policy target');
    if (!inside(policyRoot, target)) throw new PolicyHistoryError('policy transitions may modify only files under .blueprints/');
    const replacementPath = safeAbsolute(root, args.replacementPath, 'reviewed replacement');
    targetFd = openRegular(target, true, 'policy target');
    replacementFd = openRegular(replacementPath, false, 'reviewed replacement');
    const priorTargetRaw = readFd(targetFd, 'policy target');
    const replacementRaw = readFd(replacementFd, 'reviewed replacement');
    const current = parseRawBlueprint(priorTargetRaw, 'policy target', false);
    const reviewedReplacement = parseRawBlueprint(replacementRaw, 'reviewed replacement', true);
    if (reviewDigest(current) !== args.expectedBaseDigest || args.review.evidence.baseDigest !== args.expectedBaseDigest) throw new PolicyHistoryError('policy target does not match the reviewed base digest');
    if (reviewDigest(reviewedReplacement) !== args.expectedCandidateDigest || args.review.evidence.candidateDigest !== args.expectedCandidateDigest) throw new PolicyHistoryError('replacement does not match the reviewed candidate digest');
    if (readFd(targetFd, 'policy target') !== priorTargetRaw || readFd(replacementFd, 'reviewed replacement') !== replacementRaw) throw new PolicyHistoryError('policy input changed after review');
    if (current.metadata.status !== 'approved' || !['draft', 'proposed', 'approved'].includes(reviewedReplacement.metadata.status)) {
      throw new PolicyHistoryError('amend requires an approved current blueprint and a reviewed draft/proposed replacement');
    }
    const replacement = parseBlueprint({ ...reviewedReplacement, metadata: { ...reviewedReplacement.metadata, status: 'approved' } });
    if (replacement.metadata.id !== current.metadata.id) throw new PolicyHistoryError('replacement blueprint id must match current id');
    if (!semverGreater(replacement.metadata.version, current.metadata.version)) throw new PolicyHistoryError(`replacement version ${replacement.metadata.version} must be greater than ${current.metadata.version}`);
    const fromRef = `${current.metadata.id}@${current.metadata.version}`;
    const toRef = `${replacement.metadata.id}@${replacement.metadata.version}`;
    const entry = historyEntry('amend', current.metadata.id, fromRef, toRef, args.compatibility, args.review, args.proof);
    entry.outputDigest = reviewDigest(replacement);
    adoption = prepareAdoptionUpdate(root, fromRef, toRef, entry);
    args.assertFresh();
    executeTransition({ root, policyRoot, target, targetFd, priorTargetRaw, output: stableStringify(replacement), entry, ...(adoption ? { adoption } : {}) });
    return { blueprint: replacement, entry };
  } catch (error) {
    preserveTransitionLock = error instanceof PolicyHistoryError && error.preserveTransitionLock;
    throw error;
  } finally {
    if (adoption?.fd !== undefined) fs.closeSync(adoption.fd);
    if (replacementFd !== undefined) fs.closeSync(replacementFd);
    if (targetFd !== undefined) fs.closeSync(targetFd);
    if (preserveTransitionLock) preserveLock(lock);
    else releaseLock(lock);
  }
}

export function readPolicyHistory(repoDir: string): PolicyHistoryEntry[] {
  const root = fs.realpathSync(repoDir);
  const p = path.join(root, POLICY_HISTORY_RELPATH);
  if (!fs.existsSync(p)) return [];
  assertSafeAncestors(root, p, 'policy history');
  const fd = openRegular(p, false, 'policy history');
  let raw: string;
  try { raw = readFd(fd, 'policy history'); }
  finally { fs.closeSync(fd); }
  return raw.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).map((line, i) => {
    try { return JSON.parse(line) as PolicyHistoryEntry; }
    catch (error) { throw new PolicyHistoryError(`${POLICY_HISTORY_RELPATH} line ${i + 1} invalid: ${(error as Error).message}`); }
  });
}

function adoptionState(ratified: boolean, mode: GateMode): string {
  return ratified ? `ratified-${mode}` : mode === 'advisory' ? 'proposed' : 'enforced-unratified';
}

function readAdoption(root: string): Record<string, unknown> | undefined {
  const target = path.join(root, '.bce-adoption.json');
  assertSafeAncestors(root, target, 'adoption record');
  if (!fs.existsSync(target)) return undefined;
  const fd = openRegular(target, false, 'adoption record');
  try {
    const value = JSON.parse(readFd(fd, 'adoption record')) as Record<string, unknown>;
    if (!value || Array.isArray(value) || value.schemaVersion !== '1' || typeof value.ratified !== 'boolean' ||
        typeof value.blueprintRef !== 'string' || !/^.+@\d+\.\d+\.\d+$/.test(value.blueprintRef) ||
        !['advisory', 'enforced'].includes(String(value.mode)) ||
        value.state !== adoptionState(value.ratified, value.mode as GateMode)) {
      throw new PolicyHistoryError('adoption record has invalid or contradictory lifecycle fields');
    }
    return value;
  } finally { fs.closeSync(fd); }
}

interface AdoptionUpdate { fd?: number; path: string; prior?: string; output: string }

function prepareAdoptionUpdate(root: string, fromRef: string, toRef: string, entry: PolicyHistoryEntry):
  AdoptionUpdate | undefined {
  const mode = resolveMode(root).mode;
  const reviewMode = entry.reviewerAuthentication?.reviewMode ?? 'non-author-reviewed';
  const target = path.join(root, '.bce-adoption.json');
  const data = readAdoption(root);
  if (!data) return { path: target, output: stableStringify({ schemaVersion: '1', blueprintRef: toRef, ratified: true, state: adoptionState(true, mode), mode, reviewMode }) };
  // Other blueprints may have their own ceremonies without changing the adopted contract.
  if (String(data.blueprintRef).split('@')[0] !== fromRef.split('@')[0]) return undefined;
  if (data.blueprintRef !== fromRef) throw new PolicyHistoryError('adoption blueprint reference is stale');
  if (data.mode !== mode) throw new PolicyHistoryError('adoption mode contradicts actual enforcement mode');
  const fd = openRegular(target, true, 'adoption record');
  try {
    const prior = readFd(fd, 'adoption record');
    if (stableStringify(JSON.parse(prior)) !== stableStringify(data)) throw new PolicyHistoryError('adoption changed during transition');
    return { fd, path: target, prior, output: stableStringify({ ...data, ratified: true,
      state: adoptionState(true, mode), mode, blueprintRef: toRef,
      reviewMode: entry.reviewerAuthentication?.reviewMode ?? 'non-author-reviewed' }) };
  } catch (e) { fs.closeSync(fd); throw e; }
}

/** Refuse contradictory truth records, including stale refs and unrecorded approvals. */
export function auditAdoption(repoDir: string): string | undefined {
  const root = fs.realpathSync(repoDir);
  if (fs.existsSync(path.join(root, '.blueprints', TRANSITION_LOCK_BASENAME))) throw new PolicyHistoryError('unfinished policy transition; attended recovery required');
  const data = readAdoption(root);
  if (!data) return undefined;
  const mode = resolveMode(root).mode;
  if (data.mode !== mode) throw new PolicyHistoryError('adoption mode contradicts actual enforcement mode');
  const policyRoot = path.join(root, '.blueprints');
  assertSafeAncestors(root, policyRoot, 'policy directory');
  const blueprints = fs.readdirSync(policyRoot).filter((file) => file.endsWith('.blueprint.json')).map((file) => {
    const target = safeAbsolute(root, path.join(policyRoot, file), 'adopted blueprint');
    return parseBlueprint(JSON.parse(fs.readFileSync(target, 'utf8')));
  });
  const matching = blueprints.filter((bp) => `${bp.metadata.id}@${bp.metadata.version}` === data.blueprintRef);
  if (matching.length !== 1) throw new PolicyHistoryError('adoption blueprint reference is missing, stale, or ambiguous');
  const bp = matching[0]!;
  if ((bp.metadata.status === 'approved') !== data.ratified) throw new PolicyHistoryError('blueprint approval status contradicts adoption ratification');
  if (data.ratified) {
    const latest = readPolicyHistory(root).filter((entry) => entry.blueprintId === bp.metadata.id).at(-1);
    if (!latest || latest.toRef !== data.blueprintRef || latest.reviewerType !== 'scm-authenticated' || !latest.reviewerAuthentication || !latest.reviewEvidence ||
        (latest.outputDigest !== undefined && latest.outputDigest !== reviewDigest(bp))) {
      throw new PolicyHistoryError('adoption ratification lacks matching authenticated policy history');
    }
    const reviewMode = latest.reviewerAuthentication.reviewMode ?? 'non-author-reviewed';
    if (data.reviewMode !== reviewMode) throw new PolicyHistoryError('adoption review mode contradicts policy history');
  }
  const graduation = readGraduationRecord(root).at(-1);
  if (graduation && graduation.to !== mode) throw new PolicyHistoryError('graduation history contradicts enforcement mode');
  return `${data.state}: ${data.blueprintRef}; ${data.ratified ? data.reviewMode : 'ratification pending'}`;
}

/** One lock covers mode, graduation history and adoption. A torn write keeps the gate blocked. */
export function transitionAdoptionMode(repoDir: string, target: GateMode, rationale: string): boolean {
  const root = fs.realpathSync(repoDir);
  auditAdoption(root);
  const policyRoot = ensurePolicyRoot(root);
  const lock = acquireLock(policyRoot);
  let preserve = false;
  try {
    const current = resolveMode(root).mode;
    const adoption = readAdoption(root);
    if (adoption && adoption.mode !== current) throw new PolicyHistoryError('adoption mode contradicts actual enforcement mode; repair the record explicitly');
    if (current === target) return false;
    if (target === 'advisory' && rationale.trim().length < 10) throw new PolicyHistoryError('downgrade requires a substantive rationale');
    const paths = [path.join(root, MODE_CONFIG_BASENAME), path.join(root, GRADUATION_RECORD_RELPATH),
      ...(adoption ? [path.join(root, '.bce-adoption.json')] : [])];
    const prior = paths.map((file) => {
      assertSafeAncestors(root, file, 'graduation target');
      if (!fs.existsSync(file)) return undefined;
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.nlink !== 1) throw new PolicyHistoryError('graduation target must be a regular unshared file');
      return fs.readFileSync(file, 'utf8');
    });
    const outputs = [
      formatModeConfig(target, GRADUATION_RECORD_RELPATH.split(path.sep).join('/')),
      formatGraduationRecord(prior[1], target === 'enforced' ? 'graduate' : 'downgrade', current, target, rationale),
      ...(adoption ? [stableStringify({ ...adoption, mode: target, state: adoptionState(adoption.ratified as boolean, target) })] : []),
    ];
    const handles: Array<{ path: string; fd: number; prior: string | undefined }> = [];
    try {
      for (const [index, file] of paths.entries()) {
        assertSafeAncestors(root, file, 'graduation target');
        const fd = prior[index] === undefined
          ? fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600)
          : openRegular(file, true, 'graduation target');
        handles.push({ path: file, fd, prior: prior[index] });
        if (prior[index] !== undefined && readFd(fd, 'graduation target') !== prior[index]) throw new PolicyHistoryError('graduation target changed during transition');
      }
      for (const [index, handle] of handles.entries()) {
        if (!sameOpenFile(handle.path, handle.fd)) throw new PolicyHistoryError('graduation target path changed');
        writeFd(handle.fd, outputs[index]!);
        if (!sameOpenFile(handle.path, handle.fd)) throw new PolicyHistoryError('graduation target changed during write');
      }
    } catch (e) {
      const failures: string[] = [];
      for (const handle of handles) {
        try {
          if (!sameOpenFile(handle.path, handle.fd)) throw new Error('graduation target path changed');
          if (handle.prior === undefined) fs.unlinkSync(handle.path);
          else {
            writeFd(handle.fd, handle.prior);
            if (readFd(handle.fd, 'graduation recovery') !== handle.prior) throw new Error('graduation bytes were not restored');
          }
        } catch (failure) { failures.push((failure as Error).message); }
      }
      if (failures.length) {
        preserve = true;
        throw new PolicyHistoryError(`graduation failed (${failures.join('; ')}); transition lock retained for attended recovery`, true);
      }
      throw e;
    } finally { for (const handle of handles) fs.closeSync(handle.fd); }
    return true;
  } finally { if (preserve) preserveLock(lock); else releaseLock(lock); }
}
