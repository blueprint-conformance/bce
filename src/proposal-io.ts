/** Filesystem shell for constructing bounded, disclosed proposal context. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { stableStringify } from './report.js';
import { buildProposalContext } from './review.js';
import { isProtectedPolicyPath } from './policy-change.js';
import type { ProposalContext, RepositoryPolicyDiff } from './review-contracts.js';

export const DEFAULT_PROPOSAL_OUT = '.bce/proposals';
export const DEFAULT_MAX_CONTEXT_FILES = 200;
export const DEFAULT_MAX_CONTEXT_BYTES = 512 * 1024;
export const DEFAULT_MAX_FILE_BYTES = 64 * 1024;
export const DEFAULT_GOVERNED_DIRS = ['.blueprints', '.ai/blueprints'] as const;
const POLICY_TRANSITION_LOCK_RELPATH = '.blueprints/.bce-policy-transition.lock';

const SECRET_LIKE = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)(?:id_rsa|id_ed25519|credentials|secrets?)(?:\.|$)/i,
  /\.(?:pem|key|p12|pfx)$/i,
];
const GENERATED_OR_VENDOR = [
  /(^|\/)(?:node_modules|vendor|dist|build|coverage|\.next|\.turbo)(\/|$)/,
  /(^|\/)\.bce(?:\/|$)/,
  /(^|\/)(?:package-lock|npm-shrinkwrap|pnpm-lock|yarn\.lock)(?:\.json|\.yaml)?$/,
  /(^|\/)\.git(\/|$)/,
];

export interface ProposalContextOptions {
  repoDir: string;
  intentFile: string;
  maxFiles?: number;
  maxBytes?: number;
  maxFileBytes?: number;
}

export interface QuarantineOptions {
  repoDir: string;
  out: string;
  governedDirs?: readonly string[];
}

export interface RepositorySnapshot {
  identity: string;
  revision: string;
  worktreeDigest: string;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function git(repoDir: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', repoDir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}

function normalizeRepoPath(value: string): string {
  return value.split(path.sep).join('/').replace(/^\.\//, '');
}

function isPortableAbsolute(value: string): boolean {
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || /^[/\\]{2}/.test(value);
}

function hasTraversal(value: string): boolean {
  return value.replace(/\\/g, '/').split('/').includes('..');
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function resolveExistingInside(root: string, candidate: string, label: string): string {
  if (!fs.existsSync(candidate)) throw new Error(`${label} not found: ${candidate}`);
  const real = fs.realpathSync(candidate);
  if (!isInside(root, real)) throw new Error(`${label} resolves outside --repo: ${candidate}`);
  return real;
}

function listRepositoryFiles(repoDir: string): string[] {
  try {
    const raw = execFileSync('git', ['-C', repoDir, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return raw.toString('utf8').split('\0').filter(Boolean).map(normalizeRepoPath).sort();
  } catch {
    const found: string[] = [];
    const visit = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === '.git') continue;
        const absolute = path.join(dir, entry.name);
        const rel = normalizeRepoPath(path.relative(repoDir, absolute));
        if (entry.isDirectory()) visit(absolute);
        else if (entry.isFile() || entry.isSymbolicLink()) found.push(rel);
      }
    };
    visit(repoDir);
    return found.sort();
  }
}

function listDigestFiles(repoDir: string): string[] {
  const found: string[] = [];
  const skippedDirectories = new Set(['.git', '.bce', 'node_modules', 'vendor', 'dist', 'build', 'coverage', '.next', '.turbo']);
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      const rel = normalizeRepoPath(path.relative(repoDir, absolute));
      if (rel === POLICY_TRANSITION_LOCK_RELPATH) continue;
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() || entry.isSymbolicLink()) found.push(rel);
    }
  };
  visit(repoDir);
  return found.sort();
}

function repositoryIdentity(repoDir: string): string {
  const remote = git(repoDir, ['remote', 'get-url', 'origin']);
  if (!remote) return `local/${path.basename(repoDir)}`;
  let host = '';
  let repositoryPath = '';
  const scp = /^(?:[^@]+@)?([^:]+):(.+)$/.exec(remote);
  if (scp && !remote.includes('://')) {
    host = scp[1]!.toLowerCase();
    repositoryPath = scp[2]!;
  } else {
    try {
      const parsed = new URL(remote);
      host = parsed.hostname.toLowerCase();
      repositoryPath = parsed.pathname.replace(/^\/+/, '');
    } catch {
      return `local/${path.basename(repoDir)}`;
    }
  }
  const cleaned = repositoryPath.replace(/\.git$/, '').replace(/\/$/, '');
  return host && cleaned ? `${host}/${cleaned}` : `local/${path.basename(repoDir)}`;
}

function classifyExclusion(rel: string, stat: fs.Stats, maxFileBytes: number): string | null {
  if (stat.isSymbolicLink()) return 'symbolic-link';
  if (!stat.isFile()) return 'non-regular-file';
  if (SECRET_LIKE.some((rule) => rule.test(rel))) return 'secret-like';
  if (GENERATED_OR_VENDOR.some((rule) => rule.test(rel))) return 'generated-or-vendor';
  if (stat.size > maxFileBytes) return 'oversized';
  return null;
}

function worktreeDigest(repoDir: string, paths: readonly string[]): string {
  const manifest = paths.map((rel) => {
    const absolute = path.join(repoDir, rel);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(absolute); }
    catch { return { path: rel, kind: 'missing' }; }
    if (stat.isSymbolicLink()) return { path: rel, kind: 'symlink', target: fs.readlinkSync(absolute) };
    if (!stat.isFile()) return { path: rel, kind: 'other' };
    return { path: rel, kind: 'file', bytes: stat.size, sha256: sha256(fs.readFileSync(absolute)) };
  });
  return sha256(stableStringify(manifest));
}

export function snapshotRepository(repoDirInput: string): RepositorySnapshot {
  const repoDir = fs.realpathSync(repoDirInput);
  const allPaths = listDigestFiles(repoDir);
  return {
    identity: repositoryIdentity(repoDir),
    revision: git(repoDir, ['rev-parse', 'HEAD']) ?? 'unversioned',
    worktreeDigest: worktreeDigest(repoDir, allPaths),
  };
}

function gitObject(repoDir: string, revision: string, rel: string): string | undefined {
  try {
    return execFileSync('git', ['-C', repoDir, 'show', `${revision}:${rel}`], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return undefined;
  }
}

interface RepositoryPolicyBase {
  baseRef: string;
  baseHeadRevision: string;
  baseRevision: string;
}

function validBranchName(repoDir: string, value: string): boolean {
  return git(repoDir, ['check-ref-format', '--branch', value]) === value;
}

function repositoryPolicyBase(
  repoDir: string,
  expected?: { baseRef: string; baseHeadRevision: string },
): RepositoryPolicyBase | null {
  if (expected) {
    if (!validBranchName(repoDir, expected.baseRef)) return null;
    const baseHeadRevision = git(repoDir, ['rev-parse', '--verify', `${expected.baseHeadRevision}^{commit}`]);
    if (baseHeadRevision !== expected.baseHeadRevision) return null;
    const currentRemoteBase = git(repoDir, [
      'rev-parse', '--verify', `refs/remotes/origin/${expected.baseRef}^{commit}`,
    ]);
    if (currentRemoteBase !== expected.baseHeadRevision) return null;
    const baseRevision = git(repoDir, ['merge-base', 'HEAD', baseHeadRevision]);
    return baseRevision ? { baseRef: expected.baseRef, baseHeadRevision, baseRevision } : null;
  }

  const candidates: Array<{ baseRef: string; revision: string }> = [];
  const requested = process.env.GITHUB_BASE_REF;
  if (requested && validBranchName(repoDir, requested)) {
    candidates.push({ baseRef: requested, revision: `refs/remotes/origin/${requested}` });
  }
  const remoteHead = git(repoDir, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  const remoteHeadMatch = remoteHead === null ? null : /^refs\/remotes\/origin\/(.+)$/.exec(remoteHead);
  if (remoteHeadMatch?.[1] && validBranchName(repoDir, remoteHeadMatch[1])) {
    candidates.push({ baseRef: remoteHeadMatch[1], revision: remoteHead! });
  }
  candidates.push(
    { baseRef: 'main', revision: 'refs/remotes/origin/main' },
    { baseRef: 'master', revision: 'refs/remotes/origin/master' },
  );
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.baseRef)) continue;
    seen.add(candidate.baseRef);
    const baseHeadRevision = git(repoDir, ['rev-parse', '--verify', `${candidate.revision}^{commit}`]);
    if (!baseHeadRevision) continue;
    const baseRevision = git(repoDir, ['merge-base', 'HEAD', baseHeadRevision]);
    if (baseRevision) return { baseRef: candidate.baseRef, baseHeadRevision, baseRevision };
  }
  return null;
}

/** Capture every protected A5 surface changed from the trustworthy PR base to the live tree. */
export function collectRepositoryPolicyDiff(
  repoDirInput: string,
  expectedBase?: { baseRef: string; baseHeadRevision: string },
): RepositoryPolicyDiff {
  const repoDir = fs.realpathSync(repoDirInput);
  const base = repositoryPolicyBase(repoDir, expectedBase);
  if (base === null) return { baseRef: null, baseHeadRevision: null, baseRevision: null, complete: false, files: [] };
  const names = new Set<string>();
  try {
    const changed = execFileSync('git', ['-C', repoDir, 'diff', '--no-renames', '--name-only', '-z', base.baseRevision, '--'], {
      encoding: 'buffer', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024,
    }).toString('utf8').split('\0').filter(Boolean);
    for (const rel of changed.map(normalizeRepoPath)) {
      if (rel !== POLICY_TRANSITION_LOCK_RELPATH && isProtectedPolicyPath(rel)) names.add(rel);
    }
    const untracked = execFileSync('git', ['-C', repoDir, 'ls-files', '--others', '--exclude-standard', '-z'], {
      encoding: 'buffer', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024,
    }).toString('utf8').split('\0').filter(Boolean);
    for (const rel of untracked.map(normalizeRepoPath)) {
      if (rel !== POLICY_TRANSITION_LOCK_RELPATH && isProtectedPolicyPath(rel)) names.add(rel);
    }
  } catch {
    return { baseRef: null, baseHeadRevision: null, baseRevision: null, complete: false, files: [] };
  }
  const files = [...names].sort().map((rel) => {
    const before = gitObject(repoDir, base.baseRevision, rel);
    const absolute = path.join(repoDir, rel);
    let after: string | undefined;
    if (fs.existsSync(absolute)) {
      const stat = fs.lstatSync(absolute);
      after = stat.isFile() ? fs.readFileSync(absolute, 'utf8') : `[BCE non-regular protected path: ${stat.isSymbolicLink() ? 'symbolic-link' : 'other'}]`;
    }
    return { path: rel, ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}) };
  });
  return { ...base, complete: true, files };
}

function looksBinary(content: Buffer): boolean {
  if (content.includes(0)) return true;
  return content.toString('utf8').includes('\uFFFD');
}

/**
 * Build the exact context that may leave the machine. It is tracked/unignored,
 * textual, size-bounded, stable-sorted, and explicit about every omission.
 */
export function collectProposalContext(options: ProposalContextOptions): ProposalContext {
  const repoDir = fs.realpathSync(options.repoDir);
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_CONTEXT_FILES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_CONTEXT_BYTES;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  if (!Number.isInteger(maxFiles) || maxFiles < 1) throw new Error('maxFiles must be a positive integer');
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error('maxBytes must be a positive integer');
  if (!Number.isInteger(maxFileBytes) || maxFileBytes < 1) throw new Error('maxFileBytes must be a positive integer');

  const requestedIntent = path.isAbsolute(options.intentFile)
    ? options.intentFile
    : path.resolve(repoDir, options.intentFile);
  const intentPath = resolveExistingInside(repoDir, requestedIntent, '--intent-file');
  const intentStat = fs.lstatSync(intentPath);
  if (!intentStat.isFile()) throw new Error('--intent-file must be a regular file');
  if (intentStat.size > maxFileBytes) throw new Error(`--intent-file exceeds the ${maxFileBytes}-byte per-file disclosure limit`);
  const intentBytes = fs.readFileSync(intentPath);
  if (looksBinary(intentBytes)) throw new Error('--intent-file must be UTF-8 text');
  const intentContent = intentBytes.toString('utf8');
  const intentRef = normalizeRepoPath(path.relative(repoDir, intentPath));

  const allPaths = listRepositoryFiles(repoDir);
  const snapshot = snapshotRepository(repoDir);
  const files: Array<{ path: string; content: string }> = [];
  const excludedPaths: string[] = [];
  const excludedClasses = new Set<string>([
    'binary',
    'context-budget',
    'generated-or-vendor',
    'non-regular-file',
    'oversized',
    'secret-like',
    'symbolic-link',
  ]);
  let disclosedBytes = Buffer.byteLength(intentContent);
  for (const rel of allPaths) {
    if (rel === intentRef) continue;
    const absolute = path.join(repoDir, rel);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(absolute); }
    catch {
      excludedPaths.push(rel);
      excludedClasses.add('unreadable');
      continue;
    }
    const excluded = classifyExclusion(rel, stat, maxFileBytes);
    if (excluded) {
      excludedPaths.push(rel);
      excludedClasses.add(excluded);
      continue;
    }
    const bytes = fs.readFileSync(absolute);
    if (looksBinary(bytes)) {
      excludedPaths.push(rel);
      excludedClasses.add('binary');
      continue;
    }
    if (files.length >= maxFiles || disclosedBytes + bytes.length > maxBytes) {
      excludedPaths.push(rel);
      excludedClasses.add('context-budget');
      continue;
    }
    files.push({ path: rel, content: bytes.toString('utf8') });
    disclosedBytes += bytes.length;
  }

  return buildProposalContext({
    // Proposal artifacts are evidence about the input worktree, not part of it. Keeping the
    // quarantine out of this digest prevents writing a packet from making itself stale.
    repository: snapshot,
    files,
    humanIntent: intentContent,
    authoritativeIntentRefs: [{ ref: intentRef, content: intentContent }],
    excluded: { paths: excludedPaths.sort(), classes: [...excludedClasses].sort() },
  });
}

function normalizedGoverned(root: string, value: string): string {
  if (!value || value === '.' || value.includes('\0') || isPortableAbsolute(value) || hasTraversal(value)) {
    throw new Error(`governed directory must be a canonical repository-relative path: ${value}`);
  }
  const target = path.resolve(root, value);
  if (!isInside(root, target)) throw new Error(`governed directory escapes --repo: ${value}`);
  return target;
}

function assertNoSymlinkAncestors(root: string, target: string): void {
  const relative = path.relative(root, target);
  let cursor = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) continue;
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`quarantine path contains a symbolic link: ${cursor}`);
    const real = fs.realpathSync(cursor);
    if (!isInside(root, real)) throw new Error(`quarantine path resolves outside --repo: ${target}`);
  }
}

/** Resolve and create a non-policy quarantine root; never follows an existing symlink. */
export function prepareQuarantineRoot(options: QuarantineOptions): string {
  const root = fs.realpathSync(options.repoDir);
  if (
    !options.out || options.out === '.' || options.out.includes('\0') ||
    isPortableAbsolute(options.out) || hasTraversal(options.out)
  ) throw new Error('--out escapes --repo or is not a canonical repository-relative quarantine directory');
  const target = path.resolve(root, options.out);
  if (target === root || !isInside(root, target)) throw new Error(`--out escapes --repo: ${options.out}`);
  const governed = (options.governedDirs ?? DEFAULT_GOVERNED_DIRS).map((dir) => normalizedGoverned(root, dir));
  for (const policyRoot of governed) {
    if (isInside(policyRoot, target) || isInside(target, policyRoot)) {
      throw new Error(`--out overlaps governed policy directory ${normalizeRepoPath(path.relative(root, policyRoot))}`);
    }
  }
  assertNoSymlinkAncestors(root, target);
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  fs.chmodSync(target, 0o700);
  assertNoSymlinkAncestors(root, target);
  const real = fs.realpathSync(target);
  if (!isInside(root, real)) throw new Error(`--out resolves outside --repo: ${options.out}`);
  return real;
}

/** Safe leaf creation: the assistant controls neither separators nor overwrite behavior. */
export function createProposalDirectory(quarantineRoot: string, proposalId: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(proposalId)) {
    throw new Error(`proposal id must be lowercase kebab-case (got '${proposalId}')`);
  }
  const root = fs.realpathSync(quarantineRoot);
  const target = path.join(root, proposalId);
  if (!isInside(root, target)) throw new Error('proposal id escapes quarantine root');
  if (fs.existsSync(target)) throw new Error(`proposal directory already exists: ${target}`);
  fs.mkdirSync(target, { mode: 0o700 });
  return target;
}

export function createProposalStagingDirectory(quarantineRoot: string): string {
  const root = fs.realpathSync(quarantineRoot);
  const target = fs.mkdtempSync(path.join(root, '.attempt-'));
  fs.chmodSync(target, 0o700);
  return target;
}

export function finalizeProposalDirectory(stagingDir: string, finalId: string): string {
  if (!/^(?:failed-)?[a-z0-9][a-z0-9-]{0,127}$/.test(finalId)) {
    throw new Error(`final proposal id must be lowercase kebab-case (got '${finalId}')`);
  }
  const staging = fs.realpathSync(stagingDir);
  const root = fs.realpathSync(path.dirname(staging));
  if (!path.basename(staging).startsWith('.attempt-')) throw new Error('only a proposal staging directory may be finalized');
  const target = path.join(root, finalId);
  if (fs.existsSync(target)) throw new Error(`proposal directory already exists: ${target}`);
  fs.renameSync(staging, target);
  return target;
}

/** Resolve a read-only proposal input without following a symlink or leaving the repository. */
export function resolveProposalInput(repoDir: string, rel: string, label: string): string {
  const root = fs.realpathSync(repoDir);
  if (!rel || rel === '.' || rel.includes('\0') || isPortableAbsolute(rel) || hasTraversal(rel)) {
    throw new Error(`${label} must be a canonical repository-relative path`);
  }
  const candidate = path.resolve(root, rel);
  assertNoSymlinkAncestors(root, candidate);
  const resolved = resolveExistingInside(root, candidate, label);
  if (!fs.lstatSync(resolved).isFile()) throw new Error(`${label} must be a regular file`);
  return resolved;
}

/** Exclusive file creation; proposal evidence is append-only and never overwritten. */
export function writeProposalFile(target: string, content: string): void {
  const parent = fs.realpathSync(path.dirname(target));
  const fd = fs.openSync(path.join(parent, path.basename(target)), 'wx', 0o600);
  try { fs.writeFileSync(fd, content, 'utf8'); }
  finally { fs.closeSync(fd); }
}
