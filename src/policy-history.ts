import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseBlueprint, type EngineeringBlueprint } from './schema.js';
import { stableStringify } from './report.js';
import { reviewDigest } from './review.js';

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
    if (!fs.fstatSync(fd).isFile()) {
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
  adoption?: { fd: number; path: string; prior: string; output: string };
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
    if (args.adoption) {
      try {
        if (!sameOpenFile(args.adoption.path, args.adoption.fd)) throw new Error('adoption path changed');
        writeFd(args.adoption.fd, args.adoption.prior);
        if (readFd(args.adoption.fd, 'adoption rollback target') !== args.adoption.prior) throw new Error('adoption bytes were not restored');
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
  let adoption: { fd: number; path: string; prior: string; output: string } | undefined;
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
    target = inside(policyRoot, source) ? source : path.join(policyRoot, `${current.metadata.id}.blueprint.json`);
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
    const adoptionPath = path.join(root, '.bce-adoption.json');
    if (fs.existsSync(adoptionPath)) {
      assertSafeAncestors(root, adoptionPath, 'adoption record');
      const fd = openRegular(adoptionPath, true, 'adoption record');
      const prior = readFd(fd, 'adoption record');
      const data = JSON.parse(prior) as Record<string, unknown>;
      data.ratified = true;
      data.state = 'ratified-advisory';
      data.blueprintRef = toRef;
      adoption = { fd, path: adoptionPath, prior, output: stableStringify(data) };
    }
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
    if (adoption) fs.closeSync(adoption.fd);
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
    args.assertFresh();
    executeTransition({ root, policyRoot, target, targetFd, priorTargetRaw, output: stableStringify(replacement), entry });
    return { blueprint: replacement, entry };
  } catch (error) {
    preserveTransitionLock = error instanceof PolicyHistoryError && error.preserveTransitionLock;
    throw error;
  } finally {
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
