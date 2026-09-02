#!/usr/bin/env node
/**
 * verify-chain.mjs — ZERO-dependency evidence-chain verifier.
 *
 * Verify a directory (or a single file) of bce EvidenceRecord JSON files with
 * node alone: no npm install, no imports from this repo's src/ or dist/, no
 * network. This is the reviewer-facing counterpart of `src/emit.ts` — it
 * re-implements the canonical serialization + hashing contract independently,
 * so "verify the chain with node alone" is literally true even for someone
 * who never builds the engine.
 *
 * Usage:
 *   node tools/verify-chain.mjs <dir-of-records | record.json>
 *
 * Directory mode: every *.json file in the directory (non-recursive, sorted
 * lexicographically by filename) MUST be an EvidenceRecord — the sorted file
 * order IS the claimed chain order. Non-record JSON in the directory is a
 * hard error, never skipped (fail-closed).
 *
 * What is verified, per record:
 *   1. shape      — all required EvidenceRecord fields are present and typed.
 *   2. re-derive  — sha256(stableStringify(body)) === record.hash, where body
 *                   is the record WITHOUT its two derived fields (`id`,
 *                   `hash`) and WITH `previousHash`. Any edit to any hashed
 *                   field makes this fail.
 *   3. id         — record.id === `evidence:<blueprintRef>:<hash[0..16]>`.
 *   4. link       — record.previousHash === the prior record's hash; the
 *                   FIRST record's previousHash MUST be the genesis sentinel
 *                   (64 zeros). A chain is only verifiable from genesis — a
 *                   truncated head cannot be verified (see
 *                   docs/evidence-format.md, redaction contract).
 *
 * Exit codes: 0 = chain intact; 1 = verification failure (first broken record
 * is named, with the reason); 2 = usage / unreadable input.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const GENESIS = '0'.repeat(64);

/** Canonical serializer — MUST byte-match src/report.ts stableStringify: recursively
 *  sorted keys, 2-space indent, trailing newline. */
function stableStringify(value) {
  const seen = new WeakSet();
  const sort = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) throw new Error('cannot serialize a cycle');
    seen.add(v);
    if (Array.isArray(v)) return v.map(sort);
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sort(v[k]);
    return out;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

const REQUIRED = [
  ['schemaVersion', 'string'],
  ['id', 'string'],
  ['traceId', 'string'],
  ['blueprintRef', 'string'],
  ['ctRepoRevision', 'string'],
  ['score', 'number'],
  ['verdict', 'string'],
  ['violationCount', 'number'],
  ['reportEvidenceRef', 'string'],
  ['previousHash', 'string'],
  ['hash', 'string'],
];
const OPTIONAL = new Set(['toolchain']);

function toolchainError(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return "field 'toolchain' is not an object";
  const exact = (object, fields, label) => {
    if (object === null || typeof object !== 'object' || Array.isArray(object)) return `${label} is not an object`;
    const missing = fields.filter((field) => !(field in object));
    if (missing.length > 0) return `${label} missing ${missing.join(', ')}`;
    const extra = Object.keys(object).filter((field) => !fields.includes(field));
    return extra.length > 0 ? `${label} has unexpected field(s): ${extra.join(', ')}` : null;
  };
  let error = exact(value, ['engine', 'dependencyLock', 'runtime', 'extractor'], 'toolchain');
  if (error) return error;
  error = exact(value.engine, ['name', 'version'], 'toolchain.engine');
  if (error) return error;
  error = exact(value.dependencyLock, ['file', 'sha256'], 'toolchain.dependencyLock');
  if (error) return error;
  error = exact(value.runtime, ['node', 'npm', 'platform', 'arch'], 'toolchain.runtime');
  if (error) return error;
  error = exact(value.extractor, ['kind', 'profile', 'provider', 'version'], 'toolchain.extractor');
  if (error) return error;
  if (value.engine.name !== 'bce-engine') return "toolchain.engine.name must be 'bce-engine'";
  if (value.dependencyLock.file !== 'npm-shrinkwrap.json') return "toolchain.dependencyLock.file must be 'npm-shrinkwrap.json'";
  if (!/^[0-9a-f]{64}$/.test(value.dependencyLock.sha256)) return 'toolchain.dependencyLock.sha256 is not 64 lowercase hex chars';
  for (const [label, field] of [
    ['toolchain.engine.version', value.engine.version], ['toolchain.runtime.node', value.runtime.node],
    ['toolchain.runtime.npm', value.runtime.npm], ['toolchain.runtime.platform', value.runtime.platform],
    ['toolchain.runtime.arch', value.runtime.arch], ['toolchain.extractor.kind', value.extractor.kind],
    ['toolchain.extractor.profile', value.extractor.profile], ['toolchain.extractor.provider', value.extractor.provider],
    ['toolchain.extractor.version', value.extractor.version],
  ]) if (typeof field !== 'string' || field.length === 0) return `${label} is not a non-empty string`;
  return null;
}

/** Returns null if the record is well-shaped, else a reason string. */
function shapeError(rec) {
  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) return 'not a JSON object';
  for (const [field, type] of REQUIRED) {
    if (!(field in rec)) return `missing required field '${field}'`;
    if (typeof rec[field] !== type) return `field '${field}' is not a ${type}`;
  }
  const extra = Object.keys(rec).filter((k) => !REQUIRED.some(([f]) => f === k) && !OPTIONAL.has(k));
  if (extra.length > 0) return `unexpected field(s): ${extra.join(', ')} (a record is hashed over a closed field set)`;
  if (rec.schemaVersion !== '1') return `unknown schemaVersion '${rec.schemaVersion}' (expected '1')`;
  if (!/^[0-9a-f]{64}$/.test(rec.hash)) return `'hash' is not 64 lowercase hex chars`;
  if (!/^[0-9a-f]{64}$/.test(rec.previousHash)) return `'previousHash' is not 64 lowercase hex chars`;
  if (rec.verdict !== 'pass' && rec.verdict !== 'fail') return `'verdict' must be 'pass' | 'fail'`;
  if (rec.toolchain !== undefined) {
    const error = toolchainError(rec.toolchain);
    if (error) return error;
  }
  return null;
}

function fail(file, reason) {
  process.stderr.write(`FAIL  ${file}\n      ${reason}\n`);
  process.stderr.write('verify-chain: CHAIN BROKEN\n');
  process.exit(1);
}

function usage(msg) {
  process.stderr.write(`${msg}\nusage: node tools/verify-chain.mjs <dir-of-records | record.json>\n`);
  process.exit(2);
}

const target = process.argv[2];
if (!target) usage('missing argument');
if (!fs.existsSync(target)) usage(`not found: ${target}`);

let files;
if (fs.statSync(target).isDirectory()) {
  files = fs
    .readdirSync(target)
    .filter((n) => n.endsWith('.json'))
    .sort()
    .map((n) => path.join(target, n));
  if (files.length === 0) usage(`no *.json record files in ${target}`);
} else {
  files = [target];
}

let prev = GENESIS;
for (let i = 0; i < files.length; i++) {
  const file = files[i];
  let rec;
  try {
    rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail(file, `unreadable / not valid JSON: ${e.message}`);
  }

  const shapeErr = shapeError(rec);
  if (shapeErr) fail(file, shapeErr);

  // link check first: the claimed order must chain.
  if (rec.previousHash !== prev) {
    fail(
      file,
      i === 0
        ? `first record's previousHash is not the genesis sentinel (${GENESIS.slice(0, 8)}…) — a chain is only verifiable from genesis`
        : `previousHash ${rec.previousHash.slice(0, 16)}… does not match the prior record's hash ${prev.slice(0, 16)}…`,
    );
  }

  // re-derivation: strip the two DERIVED fields (id, hash), keep previousHash, re-hash.
  const { id, hash, ...body } = rec;
  const derived = sha256(stableStringify(body));
  if (derived !== hash) {
    fail(file, `hash does not re-derive: stored ${hash.slice(0, 16)}…, derived ${derived.slice(0, 16)}… (a hashed field was edited)`);
  }
  const expectedId = `evidence:${rec.blueprintRef}:${hash.slice(0, 16)}`;
  if (id !== expectedId) {
    fail(file, `id '${id}' does not match content-derived id '${expectedId}'`);
  }

  process.stdout.write(
    `OK    ${path.basename(file)}  ${rec.blueprintRef} @ ${rec.ctRepoRevision.slice(0, 12)}  ` +
      `score ${rec.score} (${rec.verdict})  ${rec.previousHash.slice(0, 8)}… -> ${hash.slice(0, 8)}…\n`,
  );
  prev = rec.hash;
}

process.stdout.write(`verify-chain: CHAIN INTACT — ${files.length} record(s), genesis -> ${prev.slice(0, 16)}…\n`);
