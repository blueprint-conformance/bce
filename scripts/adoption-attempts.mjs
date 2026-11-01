#!/usr/bin/env node
/** Source-checkout, opt-in local collection. Supplied facts remain claims; hashes are not witnesses. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import Ajv from 'ajv';
import { parseBlueprint, stableStringify } from '../dist/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_EVENTS = 10_000;
const ID = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const ZERO = '0'.repeat(64);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const readJson = file => JSON.parse(readBytes(file).toString('utf8'));
const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addSchema(readJson(path.join(ROOT, 'research/adoption-record.schema.json')));
const eventSchema = readJson(path.join(ROOT, 'research/adoption-attempt.schema.json'));
const validateEvent = ajv.compile(eventSchema);
// Published report conditionals inherit their types from the containing schema.
const validateReport = new Ajv({ allErrors: true, strict: false }).compile(readJson(path.join(ROOT, 'spec/schemas/compliance-report.schema.json')));

function readBytes(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > MAX_BYTES) fail('evidence must be a bounded regular file, without a symbolic link');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const current = fs.fstatSync(fd);
    if (!current.isFile() || current.size > MAX_BYTES) fail('evidence changed or exceeds byte limit');
    const bytes = Buffer.alloc(current.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (!read) break;
      length += read;
    }
    if (length !== current.size) fail('evidence changed during read');
    return bytes.subarray(0, length);
  } finally { fs.closeSync(fd); }
}

function storeRoot(store, create = false) {
  const target = path.resolve(store);
  if (path.basename(target) !== 'adoption-attempts' || path.basename(path.dirname(target)) !== '.bce') {
    fail('store must be <existing-directory>/.bce/adoption-attempts');
  }
  const root = fs.realpathSync(path.dirname(path.dirname(target)));
  let directory = root;
  for (const segment of ['.bce', 'adoption-attempts']) {
    directory = path.join(directory, segment);
    if (!fs.existsSync(directory)) {
      if (!create) return null;
      fs.mkdirSync(directory, { mode: 0o700 });
    }
    if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) fail('store must not contain symbolic links');
  }
  return directory;
}

function validate(event) {
  if (Buffer.byteLength(stableStringify(event)) > MAX_EVENT_BYTES) fail('attempt event exceeds byte limit');
  if (!validateEvent(event)) fail(`invalid attempt event: ${ajv.errorsText(validateEvent.errors)}`);
  if (!Number.isFinite(Date.parse(event.recordedAt)) || new Date(event.recordedAt).toISOString() !== event.recordedAt) fail('invalid event timestamp');
  const { hash, ...body } = event;
  if (sha256(stableStringify(body)) !== hash) fail('attempt event digest mismatch');
}

function loadAttempt(root, attemptId) {
  if (typeof attemptId !== 'string' || !ID.test(attemptId) || attemptId === 'artifacts') fail('invalid or reserved attempt ID');
  const directory = path.join(root, attemptId);
  if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) fail('attempt must be a regular directory');
  const names = fs.readdirSync(directory).sort();
  if (!names.length || names.length > MAX_EVENTS) fail('empty or oversized attempt ledger');
  const events = [];
  for (const [index, name] of names.entries()) {
    if (name !== `${String(index + 1).padStart(6, '0')}.json`) fail('attempt event sequence is incomplete or noncanonical');
    const event = readJson(path.join(directory, name));
    validate(event);
    const prior = events.at(-1);
    if (event.attemptId !== attemptId || event.sequence !== index + 1 || event.previousHash !== (prior?.hash ?? ZERO)) fail('attempt event chain mismatch');
    if (prior && event.recordedAt < prior.recordedAt) fail('attempt event time moved backwards');
    if (index === 0 && event.type !== 'started') fail('attempt must start with a started event');
    if (index > 0 && event.type === 'started') fail('attempt cannot restart');
    if (prior?.type === 'finished') fail('finished attempts cannot receive more events; start a new attempt');
    events.push(event);
  }
  return events;
}

function append(root, attemptId, type, payload, prior = []) {
  const body = {
    schemaVersion: '1', kind: 'AdoptionAttemptEvent', attemptId, type,
    sequence: prior.length + 1, recordedAt: new Date().toISOString(),
    previousHash: prior.at(-1)?.hash ?? ZERO, payload,
  };
  const event = { ...body, hash: sha256(stableStringify(body)) };
  validate(event);
  if (prior.at(-1)?.type === 'finished') fail('finished attempts cannot receive more events; start a new attempt');
  if (prior.at(-1)?.recordedAt > event.recordedAt) fail('clock moved backwards');
  if (event.sequence > MAX_EVENTS) fail('attempt event limit exceeded');
  // Exclusive sequence allocation prevents two concurrent writers from replacing each other.
  fs.writeFileSync(path.join(root, attemptId, `${String(event.sequence).padStart(6, '0')}.json`), stableStringify(event), { flag: 'wx', mode: 0o600 });
  return event;
}

export function startAttempt({ store, input }) {
  const { attemptId, ...payload } = input;
  if (typeof attemptId !== 'string' || !ID.test(attemptId) || attemptId === 'artifacts') fail('invalid or reserved attempt ID');
  // Validate before creating any ledger entry or directory.
  const body = { schemaVersion: '1', kind: 'AdoptionAttemptEvent', attemptId, type: 'started', sequence: 1,
    recordedAt: new Date().toISOString(), previousHash: ZERO, payload };
  validate({ ...body, hash: sha256(stableStringify(body)) });
  const root = storeRoot(store, true);
  const directory = path.join(root, attemptId);
  fs.mkdirSync(directory, { mode: 0o700 });
  try { return append(root, attemptId, 'started', payload); }
  catch (error) { fs.rmdirSync(directory); throw error; }
}

function artifact(root, bytes) {
  const digest = sha256(bytes);
  const directory = path.join(root, 'artifacts');
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
  if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) fail('artifact store is not a regular directory');
  const target = path.join(directory, `${digest}.json`);
  try { fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST' || sha256(readBytes(target)) !== digest) throw error;
  }
  return { sha256: digest, ref: `artifacts/${digest}.json`, bytes: bytes.length };
}

function observedUse(gateBytes, blueprintBytes, repositoryId, constraintId) {
  if (!ID.test(repositoryId ?? '')) fail('repositoryId must be a pseudonymous ID');
  const blueprint = parseBlueprint(JSON.parse(blueprintBytes.toString('utf8')));
  if (!blueprint.constraints.some(constraint => constraint.id === constraintId)) fail('constraintId is not present in the supplied blueprint');
  const gate = JSON.parse(gateBytes.toString('utf8'));
  if (gate.schemaVersion !== '1' || !['pass', 'violation', 'refusal'].includes(gate.outcome) ||
      !['enforced', 'advisory'].includes(gate.mode) || ![0, 1, 2].includes(gate.exitCode) ||
      typeof gate.baselineActive !== 'boolean' || typeof gate.gateFailed !== 'boolean' ||
      !Array.isArray(gate.refusals) || !Array.isArray(gate.reports) || !gate.reports.length ||
      !Number.isInteger(gate.blueprintsDiscovered) || !Number.isInteger(gate.blueprintsSelected) ||
      gate.blueprintsSelected !== gate.reports.length || gate.blueprintsDiscovered < gate.blueprintsSelected) {
    fail('expected a supported bce gate --report-json document with selected reports');
  }
  const exit = gate.outcome === 'refusal' ? 2 : gate.outcome === 'violation' && gate.mode === 'enforced' ? 1 : 0;
  if (gate.exitCode !== exit || gate.gateFailed !== (gate.outcome !== 'pass') || (gate.refusals.length > 0) !== (gate.outcome === 'refusal')) fail('gate outcome, refusal, mode, and exit evidence disagree');
  for (const report of gate.reports) if (!validateReport(report)) fail(`invalid gate compliance report: ${ajv.errorsText(validateReport.errors)}`);
  const blueprintRef = `${blueprint.metadata.id}@${blueprint.metadata.version}`;
  const matches = gate.reports.filter(report => report.blueprintRef === blueprintRef);
  if (matches.length !== 1) fail('gate must contain exactly one report for the supplied blueprint');
  const report = matches[0];
  if (!/^[a-f0-9]{40}$/.test(report.ctRepoRevision)) fail('repeat-use evidence requires an exact Git revision; unpinned reports are unsupported');
  return {
    repositoryId, constraintId, revision: report.ctRepoRevision, blueprintRef,
    reportEvidenceRef: report.evidenceRef, reportVerdict: report.verdict,
    gateOutcome: gate.outcome, gateExitCode: gate.exitCode, mode: gate.mode,
    baselineActive: gate.baselineActive,
    gradeable: gate.outcome !== 'refusal' && report.verdict !== 'indeterminate' && report.evidenceRef !== 'n/a',
  };
}

export function recordUse({ store, attemptId, input }) {
  const { gateFile, blueprintFile, repositoryId, constraintId, ...unknown } = input;
  if (Object.keys(unknown).length) fail('unknown use fields; acceptance and supplied digests cannot be recorded');
  const root = storeRoot(store);
  if (!root) fail('attempt store does not exist');
  const prior = loadAttempt(root, attemptId);
  if (prior.at(-1)?.type === 'finished') fail('finished attempts cannot receive more events; start a new attempt');
  const gateBytes = readBytes(gateFile);
  const blueprintBytes = readBytes(blueprintFile);
  const observed = observedUse(gateBytes, blueprintBytes, repositoryId, constraintId);
  const payload = { ...observed, gate: artifact(root, gateBytes), blueprint: artifact(root, blueprintBytes) };
  return append(root, attemptId, 'use-recorded', payload, prior);
}

export function finishAttempt({ store, attemptId, input }) {
  const root = storeRoot(store);
  if (!root) fail('attempt store does not exist');
  const prior = loadAttempt(root, attemptId);
  if (input.outcome === 'success' && !prior.some(event => event.type === 'use-recorded' && event.payload.gradeable)) {
    fail('a claimed successful attempt requires at least one gradeable gate artifact');
  }
  return append(root, attemptId, 'finished', input, prior);
}

function verifyUse(root, payload) {
  const readArtifact = reference => {
    const expected = `artifacts/${reference.sha256}.json`;
    if (reference.ref !== expected) fail('artifact reference mismatch');
    const directory = path.join(root, 'artifacts');
    if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) fail('artifact store must not be a link');
    const bytes = readBytes(path.join(root, expected));
    if (bytes.length !== reference.bytes || sha256(bytes) !== reference.sha256) fail('stored evidence artifact bytes changed');
    return bytes;
  };
  const observed = observedUse(readArtifact(payload.gate), readArtifact(payload.blueprint), payload.repositoryId, payload.constraintId);
  const { gate, blueprint, ...saved } = payload;
  if (stableStringify(observed) !== stableStringify(saved)) fail('recorded use does not match its evidence artifacts');
}

export function summarizeAttempts({ store }) {
  // The existing validator, not the local collector, owns independent-witness eligibility.
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/validate-adoption-program.mjs'), ROOT], { stdio: ['ignore', 'pipe', 'pipe'] });
  const program = readJson(path.join(ROOT, 'research/adoption-program.json'));
  const root = storeRoot(store);
  const attempts = [];
  const groups = new Map();
  let totalEvents = 0;
  for (const name of root ? fs.readdirSync(root).sort() : []) {
    if (name === 'artifacts') continue;
    if (!ID.test(name)) fail('unexpected entry in attempt store');
    const events = loadAttempt(root, name);
    totalEvents += events.length;
    if (totalEvents > MAX_EVENTS) fail('attempt store exceeds event limit');
    const first = events[0];
    const uses = events.filter(event => event.type === 'use-recorded');
    for (const event of uses) {
      verifyUse(root, event.payload);
      if (!event.payload.gradeable) continue;
      // A second rule or gate on the same repository revision is still one use occasion.
      const key = `${first.payload.participantId}:${event.payload.repositoryId}`;
      const group = groups.get(key) ?? { participantId: first.payload.participantId, repositoryId: event.payload.repositoryId, revisions: new Map(), gates: new Set() };
      if (!group.revisions.has(event.payload.revision) && !group.gates.has(event.payload.gate.sha256)) {
        group.revisions.set(event.payload.revision, { attemptId: name, event: `${name}/${String(event.sequence).padStart(6, '0')}.json`,
          revision: event.payload.revision, constraintId: event.payload.constraintId, blueprintRef: event.payload.blueprintRef,
          gate: event.payload.gate.ref, blueprint: event.payload.blueprint.ref });
        group.gates.add(event.payload.gate.sha256);
      }
      groups.set(key, group);
    }
    attempts.push({ attemptId: name, participantId: first.payload.participantId,
      outcome: events.at(-1).type === 'finished' ? events.at(-1).payload.outcome : 'unfinished',
      startedAt: first.recordedAt, lastRecordedAt: events.at(-1).recordedAt, recordedGateArtifacts: uses.length,
      authorControlledMachine: first.payload.relationship.authorControlledMachine,
      authorOperatedRun: first.payload.relationship.authorOperatedRun });
  }
  const repeatedUse = [...groups.values()].map(group => ({ participantId: group.participantId, repositoryId: group.repositoryId,
    distinctRevisions: group.revisions.size, claimedRepeatUses: Math.max(0, group.revisions.size - 1), evidence: [...group.revisions.values()] }));
  return {
    schemaVersion: '1', kind: 'AdoptionAttemptSummary',
    localClaims: { started: attempts.length, unfinished: attempts.filter(a => a.outcome === 'unfinished').length,
      success: attempts.filter(a => a.outcome === 'success').length, failure: attempts.filter(a => a.outcome === 'failure').length,
      abandoned: attempts.filter(a => a.outcome === 'abandoned').length,
      claimedRepeatUses: repeatedUse.reduce((sum, group) => sum + group.claimedRepeatUses, 0), attempts, repeatedUse },
    canonicalProgram: { source: 'research/adoption-program.json', outcomes: program.outcomes, status: program.status },
    acceptedIndependentAdded: 0,
    limitations: [
      'The denominator includes consented attempts explicitly started in this local ledger, not all users or unrecorded attempts.',
      'All local participant, relationship, environment, outcome, and use assertions remain unreviewed claims.',
      'Hashes verify artifact bytes and internal consistency, not their origin, execution, or whether supplied facts were fabricated.',
      'A Git revision in a report does not prove a clean worktree. Repeating the same revision does not increase repeat use.',
      'A report/blueprint identity match does not prove that the gate executed those blueprint bytes; independent adjudication requires inspectable provenance.',
      'The collector cannot prevent manual deletion, history rewriting, or fake participants. It has no publication or independent-acceptance authority.',
      'Canonical witness eligibility and counts remain governed by the existing adoption-record schema and adoption-program validator.',
    ],
  };
}

function main(argv) {
  const command = argv.shift();
  if (command === '--help' || command === 'help') {
    process.stdout.write('Source-checkout collector: adoption-attempts.mjs start|use|finish|summary --store <directory>/.bce/adoption-attempts [--attempt <id>] [--input <json>]\n');
    return;
  }
  if (!['start', 'use', 'finish', 'summary'].includes(command)) fail('expected start, use, finish, or summary');
  const args = {};
  while (argv.length) {
    const key = argv.shift();
    const value = argv.shift();
    if (!['--store', '--attempt', '--input'].includes(key) || !value || value.startsWith('--') || args[key] !== undefined) fail('unknown, missing, or duplicate CLI option');
    args[key] = value;
  }
  if (!args['--store']) fail('--store is required');
  if (command === 'summary' && (args['--attempt'] || args['--input'])) fail('summary accepts only --store');
  if (command === 'start' && args['--attempt']) fail('start takes attemptId from the input file');
  if (command !== 'summary' && !args['--input']) fail('--input is required');
  const options = { store: args['--store'], attemptId: args['--attempt'], ...(args['--input'] ? { input: readJson(args['--input']) } : {}) };
  const result = command === 'start' ? startAttempt(options) : command === 'use' ? recordUse(options) : command === 'finish' ? finishAttempt(options) : summarizeAttempts(options);
  process.stdout.write(stableStringify(result));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`adoption attempts refused: ${error.message}\n`); process.exitCode = 2; }
}
