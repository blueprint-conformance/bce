import * as path from 'node:path';

/** Semantic direction of a policy change. Unknown is fail-closed and blocks approval. */
export type PolicyChangeClass = 'tightening' | 'neutral' | 'relaxation' | 'unknown-potential-relaxation';
export interface FileChange { path: string; before?: string; after?: string }
export interface ClassifiedChange {
  path: string;
  classification: PolicyChangeClass;
  reasons: string[];
  approvalBlocked: boolean;
}
export interface PolicyChangeReport {
  schemaVersion: '1';
  classification: PolicyChangeClass;
  humanOwnerReviewRequired: boolean;
  approvalBlocked: boolean;
  changes: ClassifiedChange[];
}

type JsonObject = Record<string, unknown>;
type EvidenceKind = 'tightening' | 'relaxation' | 'unknown';
type ParsedJson = { state: 'missing' } | { state: 'invalid' } | { state: 'value'; value: JsonObject };
interface Evidence { tightening: string[]; relaxation: string[]; unknown: string[] }
interface StringSetValue { valid: boolean; present: boolean; values: Set<string> }

const SEVERITY = ['info', 'low', 'medium', 'high', 'critical'] as const;
const ON_MISSING = ['warn', 'unknown', 'block'] as const;
const ENFORCING_CONSTRAINTS = new Set([
  'requiredComponent', 'requiredDependency', 'forbiddenDependency', 'forbiddenPath',
  'forbiddenFile', 'forbiddenEgress', 'forbiddenPattern', 'behavioralInvariant',
]);
const CONSTRAINT_ARGUMENT_FIELDS = [
  'from', 'component', 'evidenceType', 'metric', 'minimum', 'policyRef', 'behaviorRef',
  'probeDefinitionHash', 'stimulusSetHash', 'environmentId',
] as const;
const CONSTRAINT_KNOWN_FIELDS = new Set([
  'id', 'type', 'severity', 'scopePaths', 'path', 'pattern', 'to', 'governedHosts',
  'forbiddenEgressHosts', 'egressCallees', ...CONSTRAINT_ARGUMENT_FIELDS,
]);
const REPORT_RANK: Record<PolicyChangeClass, number> = {
  neutral: 0,
  tightening: 1,
  'unknown-potential-relaxation': 2,
  relaxation: 3,
};

function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join('/').replaceAll('\\', '/').replace(/^\.\//, '');
}

function protectedSurface(rel: string): string | undefined {
  if (/^\.blueprints(?:\/|$)/.test(rel)) return 'blueprint policy';
  if (rel === '.bce-mode.json') return 'enforcement mode';
  if (rel === '.bce-adoption.json') return 'adoption policy';
  if (rel === '.engine-pin.json') return 'engine pin';
  if (/^\.github\/workflows(?:\/|$)/.test(rel)) return 'governance workflow';
  if (rel === 'CODEOWNERS' || rel === '.github/CODEOWNERS' || rel === 'docs/CODEOWNERS') return 'policy-file protection';
  if (/(^|\/)(?:AGENTS|AGENTS\.bce|CLAUDE)\.md$/.test(rel) || rel === '.cursorrules') return 'agent policy instructions';
  if (/^(?:skills|\.agents\/skills|\.claude\/skills|\.cursor\/skills)(?:\/|$)/.test(rel)) return 'agent skill';
  if (
    rel === 'src/mcp-server.ts' ||
    /^(?:integrations\/.*mcp.*|\.mcp\.json|\.cursor\/mcp\.json|\.codex\/config\.toml)$/i.test(rel)
  ) return 'MCP authority surface';
  if (/^src\/(?:report|score|teeth|extractor-teeth|extractors|extractor-registry|python-extractor|graph|teeth-waiver|safe-regex|observations|runtime-identity|evidence-bundle|evidence-store|emit|materializer|recall-gate|violation-format|violation-rollup|portfolio-collect|portfolio-compile|lifecycle|policy-change|policy-history)\.ts$/.test(rel)) return 'policy evaluator';
  if (rel === 'src/index.ts') return 'public policy authority surface';
  if (/^src\/(?:schema|gate|baseline|mode|pin|cli|review|review-contracts|review-render|scm-review|proposal-io|assistant-adapter)\.ts$/.test(rel)) return 'policy enforcement';
  if (/^spec\/schemas(?:\/|$)/.test(rel)) return 'published policy schema';
  if (/^(?:action\.ya?ml|package\.json|CITATION\.cff|GOVERNANCE\.md|SECURITY\.md)$/.test(rel)) return 'governance policy';
  return undefined;
}

/** Shared A5 path oracle used by packet construction and the semantic classifier. */
export function isProtectedPolicyPath(filePath: string): boolean {
  return protectedSurface(normalizePath(filePath)) !== undefined;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseObject(text: string | undefined): ParsedJson {
  if (text === undefined) return { state: 'missing' };
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? { state: 'value', value } : { state: 'invalid' };
  } catch {
    return { state: 'invalid' };
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  const result: JsonObject = {};
  for (const key of Object.keys(value).sort()) result[key] = stableValue(value[key]);
  return result;
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(stableValue(a)) === JSON.stringify(stableValue(b));
}

function evidence(): Evidence {
  return { tightening: [], relaxation: [], unknown: [] };
}

function add(result: Evidence, kind: EvidenceKind, reason: string): void {
  if (!result[kind].includes(reason)) result[kind].push(reason);
}

function classify(result: Evidence): PolicyChangeClass {
  if (result.relaxation.length > 0) return 'relaxation';
  if (result.unknown.length > 0) return 'unknown-potential-relaxation';
  if (result.tightening.length > 0) return 'tightening';
  return 'neutral';
}

function reasonsFor(result: Evidence, classification: PolicyChangeClass): string[] {
  if (classification === 'relaxation') return [...result.relaxation, ...result.unknown, ...result.tightening];
  if (classification === 'unknown-potential-relaxation') return [...result.unknown, ...result.tightening];
  if (classification === 'tightening') return result.tightening;
  return ['semantic content unchanged'];
}

function stringSet(object: JsonObject, key: string): StringSetValue {
  const raw = object[key];
  if (raw === undefined) return { valid: true, present: false, values: new Set() };
  if (!Array.isArray(raw) || raw.some((value) => typeof value !== 'string')) {
    return { valid: false, present: true, values: new Set() };
  }
  return { valid: true, present: true, values: new Set(raw as string[]) };
}

function sortedDifference(a: ReadonlySet<string>, b: ReadonlySet<string>): string[] {
  return [...a].filter((value) => !b.has(value)).sort();
}

function compareOrdinarySet(
  result: Evidence,
  before: JsonObject,
  after: JsonObject,
  key: string,
  removedKind: EvidenceKind,
  addedKind: EvidenceKind,
  label: string,
): void {
  const oldSet = stringSet(before, key);
  const newSet = stringSet(after, key);
  if (!oldSet.valid || !newSet.valid) {
    add(result, 'unknown', `${label} changed with an invalid or unsupported shape`);
    return;
  }
  const removed = sortedDifference(oldSet.values, newSet.values);
  const added = sortedDifference(newSet.values, oldSet.values);
  if (removed.length > 0) add(result, removedKind, `${label} removed: ${removed.join(', ')}`);
  if (added.length > 0) add(result, addedKind, `${label} added: ${added.join(', ')}`);
}

/** Compare an array scope where absent/empty means all values and a finite list narrows it. */
function compareRestrictingScope(result: Evidence, before: JsonObject, after: JsonObject, key: string, label: string): void {
  const oldSet = stringSet(before, key);
  const newSet = stringSet(after, key);
  if (!oldSet.valid || !newSet.valid) {
    add(result, 'unknown', `${label} changed with an invalid or unsupported shape`);
    return;
  }
  const oldAll = !oldSet.present || oldSet.values.size === 0;
  const newAll = !newSet.present || newSet.values.size === 0;
  if (oldAll && newAll) return;
  if (oldAll) {
    add(result, 'relaxation', `${label} narrowed from all values to: ${[...newSet.values].sort().join(', ')}`);
    return;
  }
  if (newAll) {
    add(result, 'tightening', `${label} widened to all values`);
    return;
  }
  const removed = sortedDifference(oldSet.values, newSet.values);
  const added = sortedDifference(newSet.values, oldSet.values);
  if (removed.length > 0) add(result, 'relaxation', `${label} narrowed by removing: ${removed.join(', ')}`);
  if (added.length > 0) add(result, 'tightening', `${label} widened by adding: ${added.join(', ')}`);
}

function compareOptionalRestriction(result: Evidence, before: unknown, after: unknown, label: string): void {
  if (before === after) return;
  if (before === undefined && typeof after === 'string') {
    add(result, 'relaxation', `${label} narrowed from all paths to: ${after}`);
  } else if (typeof before === 'string' && after === undefined) {
    add(result, 'tightening', `${label} widened to all paths`);
  } else {
    add(result, 'unknown', `${label} changed`);
  }
}

function indexByString(items: unknown, key: string, label: string, result: Evidence): Map<string, JsonObject> | undefined {
  if (!Array.isArray(items)) {
    add(result, 'unknown', `${label} changed with an invalid or unsupported shape`);
    return undefined;
  }
  const indexed = new Map<string, JsonObject>();
  for (const item of items) {
    if (!isObject(item) || typeof item[key] !== 'string' || (item[key] as string).length === 0) {
      add(result, 'unknown', `${label} changed with an invalid or unsupported shape`);
      return undefined;
    }
    const identity = item[key] as string;
    if (indexed.has(identity)) {
      add(result, 'unknown', `${label} contains duplicate identity: ${identity}`);
      return undefined;
    }
    indexed.set(identity, item);
  }
  return indexed;
}

function changedUnknownFields(
  result: Evidence,
  before: JsonObject,
  after: JsonObject,
  known: ReadonlySet<string>,
  label: string,
): void {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [...keys].filter((key) => !known.has(key) && !equal(before[key], after[key])).sort();
  if (changed.length > 0) add(result, 'unknown', `${label} changed unsupported field(s): ${changed.join(', ')}`);
}

function compareSeverity(result: Evidence, before: unknown, after: unknown, id: string): void {
  if (before === after) return;
  const oldRank = SEVERITY.indexOf(before as (typeof SEVERITY)[number]);
  const newRank = SEVERITY.indexOf(after as (typeof SEVERITY)[number]);
  if (oldRank < 0 || newRank < 0) {
    add(result, 'unknown', `constraint severity changed with an invalid value: ${id}`);
  } else if (newRank < oldRank) {
    add(result, 'relaxation', `constraint severity lowered: ${id} (${String(before)} -> ${String(after)})`);
  } else {
    add(result, 'tightening', `constraint severity raised: ${id} (${String(before)} -> ${String(after)})`);
  }
}

function compareRequiredArgument(result: Evidence, before: unknown, after: unknown, id: string, field: string): void {
  if (equal(before, after)) return;
  if (before !== undefined && after === undefined) add(result, 'relaxation', `constraint argument removed: ${id}.${field}`);
  else if (before === undefined) add(result, 'tightening', `constraint argument added: ${id}.${field}`);
  else add(result, 'unknown', `constraint argument changed: ${id}.${field}`);
}

function compareEgressConstraint(result: Evidence, before: JsonObject, after: JsonObject, id: string): void {
  const oldAllowed = stringSet(before, 'governedHosts');
  const newAllowed = stringSet(after, 'governedHosts');
  const oldForbidden = stringSet(before, 'forbiddenEgressHosts');
  const newForbidden = stringSet(after, 'forbiddenEgressHosts');
  const oldCallees = stringSet(before, 'egressCallees');
  const newCallees = stringSet(after, 'egressCallees');
  if ([oldAllowed, newAllowed, oldForbidden, newForbidden, oldCallees, newCallees].some((value) => !value.valid)) {
    add(result, 'unknown', `egress policy changed with an invalid or unsupported shape: ${id}`);
    return;
  }
  const oldAllowlistMode = oldAllowed.values.size > 0;
  const newAllowlistMode = newAllowed.values.size > 0;
  if (oldAllowlistMode !== newAllowlistMode) {
    add(result, 'unknown', `egress policy changed allowlist/blocklist mode: ${id}`);
  } else if (oldAllowlistMode) {
    const newlyAllowed = sortedDifference(newAllowed.values, oldAllowed.values);
    const noLongerAllowed = sortedDifference(oldAllowed.values, newAllowed.values);
    if (newlyAllowed.length > 0) add(result, 'relaxation', `egress allowlist expanded: ${id} (${newlyAllowed.join(', ')})`);
    if (noLongerAllowed.length > 0) add(result, 'tightening', `egress allowlist narrowed: ${id} (${noLongerAllowed.join(', ')})`);
    if (
      !equal(before.to, after.to) ||
      sortedDifference(oldForbidden.values, newForbidden.values).length > 0 ||
      sortedDifference(newForbidden.values, oldForbidden.values).length > 0
    ) add(result, 'unknown', `inactive egress blocklist configuration changed: ${id}`);
  } else {
    const oldHosts = new Set(oldForbidden.values);
    const newHosts = new Set(newForbidden.values);
    if (typeof before.to === 'string') oldHosts.add(before.to);
    else if (before.to !== undefined) add(result, 'unknown', `egress forbidden host changed with an invalid shape: ${id}.to`);
    if (typeof after.to === 'string') newHosts.add(after.to);
    else if (after.to !== undefined) add(result, 'unknown', `egress forbidden host changed with an invalid shape: ${id}.to`);
    const removed = sortedDifference(oldHosts, newHosts);
    const added = sortedDifference(newHosts, oldHosts);
    if (removed.length > 0) add(result, 'relaxation', `egress forbidden host removed: ${id} (${removed.join(', ')})`);
    if (added.length > 0) add(result, 'tightening', `egress forbidden host added: ${id} (${added.join(', ')})`);
  }
  const removedCallees = sortedDifference(oldCallees.values, newCallees.values);
  const addedCallees = sortedDifference(newCallees.values, oldCallees.values);
  if (removedCallees.length > 0) add(result, 'relaxation', `egress detector callee removed: ${id} (${removedCallees.join(', ')})`);
  if (addedCallees.length > 0) add(result, 'tightening', `egress detector callee added: ${id} (${addedCallees.join(', ')})`);
}

function compareConstraint(result: Evidence, before: JsonObject, after: JsonObject, id: string): void {
  compareSeverity(result, before.severity, after.severity, id);
  if (before.type !== after.type) add(result, 'unknown', `constraint type changed: ${id} (${String(before.type)} -> ${String(after.type)})`);

  if (before.type === after.type && before.type === 'forbiddenEgress') compareEgressConstraint(result, before, after, id);
  else {
    for (const field of ['to', 'governedHosts', 'forbiddenEgressHosts', 'egressCallees'] as const) {
      if (!equal(before[field], after[field])) add(result, 'unknown', `constraint argument changed: ${id}.${field}`);
    }
  }

  if (before.type === after.type && before.type === 'forbiddenDependency') {
    compareRestrictingScope(result, before, after, 'scopePaths', `constraint scope ${id}`);
  } else if (!equal(before.scopePaths, after.scopePaths)) add(result, 'unknown', `constraint path scope changed: ${id}.scopePaths`);

  if (before.type === after.type && before.type === 'forbiddenPattern') {
    compareRequiredArgument(result, before.pattern, after.pattern, id, 'pattern');
    compareOptionalRestriction(result, before.path, after.path, `constraint path ${id}`);
  } else {
    compareRequiredArgument(result, before.path, after.path, id, 'path');
    if (!equal(before.pattern, after.pattern)) add(result, 'unknown', `constraint pattern changed: ${id}.pattern`);
  }
  for (const field of CONSTRAINT_ARGUMENT_FIELDS) {
    if (!equal(before[field], after[field])) add(result, 'unknown', `constraint argument changed: ${id}.${field}`);
  }
  changedUnknownFields(result, before, after, CONSTRAINT_KNOWN_FIELDS, `constraint ${id}`);
}

function compareConstraints(result: Evidence, before: JsonObject, after: JsonObject): void {
  const oldConstraints = indexByString(before.constraints, 'id', 'constraints', result);
  const newConstraints = indexByString(after.constraints, 'id', 'constraints', result);
  if (!oldConstraints || !newConstraints) return;
  const removed = sortedDifference(new Set(oldConstraints.keys()), new Set(newConstraints.keys()));
  const addedIds = sortedDifference(new Set(newConstraints.keys()), new Set(oldConstraints.keys()));
  if (removed.length > 0) add(result, 'relaxation', `constraint removed: ${removed.join(', ')}`);
  for (const id of addedIds) {
    const constraint = newConstraints.get(id);
    add(
      result,
      constraint && ENFORCING_CONSTRAINTS.has(String(constraint.type)) ? 'tightening' : 'unknown',
      `${constraint && ENFORCING_CONSTRAINTS.has(String(constraint.type)) ? 'enforcing' : 'non-enforcing or unknown'} constraint added: ${id}`,
    );
  }
  for (const id of [...oldConstraints.keys()].filter((value) => newConstraints.has(value)).sort()) {
    compareConstraint(result, oldConstraints.get(id)!, newConstraints.get(id)!, id);
  }
}

function compareScope(result: Evidence, before: JsonObject, after: JsonObject): void {
  if (!isObject(before.scope) || !isObject(after.scope)) {
    if (!equal(before.scope, after.scope)) add(result, 'unknown', 'blueprint scope changed with an invalid or unsupported shape');
    return;
  }
  compareOrdinarySet(result, before.scope, after.scope, 'repositories', 'relaxation', 'tightening', 'scope repository');
  compareRestrictingScope(result, before.scope, after.scope, 'paths', 'blueprint path scope');
  compareRestrictingScope(result, before.scope, after.scope, 'environments', 'blueprint environment scope');
  changedUnknownFields(result, before.scope, after.scope, new Set(['repositories', 'paths', 'environments']), 'blueprint scope');
}

function compareEvidenceRequirement(result: Evidence, before: JsonObject, after: JsonObject, type: string): void {
  if (before.required !== after.required) {
    if (before.required === true && after.required !== true) add(result, 'relaxation', `required evidence made optional: ${type}`);
    else if (before.required !== true && after.required === true) add(result, 'tightening', `optional evidence made required: ${type}`);
    else add(result, 'unknown', `evidence required flag changed with an invalid value: ${type}`);
  }
  if (before.onMissing !== after.onMissing) {
    const oldRank = ON_MISSING.indexOf(before.onMissing as (typeof ON_MISSING)[number]);
    const newRank = ON_MISSING.indexOf(after.onMissing as (typeof ON_MISSING)[number]);
    if (oldRank >= 0 && newRank >= 0) {
      const weakened = newRank < oldRank;
      add(result, weakened ? 'relaxation' : 'tightening', `missing-evidence handling ${weakened ? 'weakened' : 'strengthened'}: ${type} (${String(before.onMissing)} -> ${String(after.onMissing)})`);
    } else if (before.onMissing !== undefined && after.onMissing === undefined) {
      add(result, 'relaxation', `missing-evidence handling removed: ${type}`);
    } else add(result, 'unknown', `missing-evidence handling changed across an unspecified default: ${type}`);
  }
  for (const key of ['freshnessSeconds', 'minimumCoverage'] as const) {
    if (before[key] === after[key]) continue;
    const oldValue = before[key];
    const newValue = after[key];
    if (typeof oldValue === 'number' && typeof newValue === 'number') {
      const weakened = key === 'freshnessSeconds' ? newValue > oldValue : newValue < oldValue;
      add(result, weakened ? 'relaxation' : 'tightening', `${key} ${weakened ? 'weakened' : 'strengthened'}: ${type}`);
    } else add(result, 'unknown', `evidence ${key} changed across an unspecified default: ${type}`);
  }
  if (!equal(before.producerPolicy, after.producerPolicy)) add(result, 'unknown', `evidence producer policy changed: ${type}`);
  changedUnknownFields(
    result,
    before,
    after,
    new Set(['type', 'required', 'onMissing', 'freshnessSeconds', 'minimumCoverage', 'producerPolicy']),
    `evidence requirement ${type}`,
  );
}

function compareEvidenceRequirements(result: Evidence, before: JsonObject, after: JsonObject): void {
  const oldRequirements = indexByString(before.evidenceRequirements, 'type', 'evidence requirements', result);
  const newRequirements = indexByString(after.evidenceRequirements, 'type', 'evidence requirements', result);
  if (!oldRequirements || !newRequirements) return;
  const removed = sortedDifference(new Set(oldRequirements.keys()), new Set(newRequirements.keys()));
  const added = sortedDifference(new Set(newRequirements.keys()), new Set(oldRequirements.keys()));
  for (const type of removed) {
    const required = oldRequirements.get(type)?.required === true;
    add(result, required ? 'relaxation' : 'unknown', `${required ? 'required ' : ''}evidence requirement removed: ${type}`);
  }
  for (const type of added) {
    const required = newRequirements.get(type)?.required === true;
    add(result, required ? 'tightening' : 'unknown', `${required ? 'required' : 'optional'} evidence requirement added: ${type}`);
  }
  for (const type of [...oldRequirements.keys()].filter((value) => newRequirements.has(value)).sort()) {
    compareEvidenceRequirement(result, oldRequirements.get(type)!, newRequirements.get(type)!, type);
  }
}

function approvalIdentity(value: JsonObject): string | undefined {
  return typeof value.role === 'string' && typeof value.stage === 'string' ? `${value.role}\u0000${value.stage}` : undefined;
}

function approvalSet(value: unknown, result: Evidence): Map<string, JsonObject> | undefined {
  if (!Array.isArray(value)) {
    add(result, 'unknown', 'approvals changed with an invalid or unsupported shape');
    return undefined;
  }
  const approvals = new Map<string, JsonObject>();
  for (const entry of value) {
    if (!isObject(entry)) {
      add(result, 'unknown', 'approvals changed with an invalid or unsupported shape');
      return undefined;
    }
    const identity = approvalIdentity(entry);
    if (!identity || approvals.has(identity)) {
      add(result, 'unknown', 'approvals contain an invalid or duplicate role/stage requirement');
      return undefined;
    }
    approvals.set(identity, entry);
  }
  return approvals;
}

function displayApproval(identity: string): string {
  return identity.replace('\u0000', '/');
}

function compareApprovals(result: Evidence, before: JsonObject, after: JsonObject): void {
  const oldApprovals = approvalSet(before.approvals, result);
  const newApprovals = approvalSet(after.approvals, result);
  if (!oldApprovals || !newApprovals) return;
  const removed = sortedDifference(new Set(oldApprovals.keys()), new Set(newApprovals.keys()));
  const added = sortedDifference(new Set(newApprovals.keys()), new Set(oldApprovals.keys()));
  if (removed.length > 0) add(result, 'relaxation', `approval requirement removed or changed: ${removed.map(displayApproval).join(', ')}`);
  if (added.length > 0) add(result, 'tightening', `approval requirement added: ${added.map(displayApproval).join(', ')}`);
  for (const identity of [...oldApprovals.keys()].filter((value) => newApprovals.has(value)).sort()) {
    changedUnknownFields(result, oldApprovals.get(identity)!, newApprovals.get(identity)!, new Set(['role', 'stage']), `approval ${displayApproval(identity)}`);
  }
}

function compareExtraction(result: Evidence, before: JsonObject, after: JsonObject): void {
  if (equal(before.extraction, after.extraction)) return;
  if (!isObject(before.extraction) || !isObject(after.extraction)) {
    add(result, 'unknown', 'extractor profile/configuration added, removed, or malformed');
    return;
  }
  const oldExtraction = before.extraction;
  const newExtraction = after.extraction;
  const oldMin = oldExtraction.minFiles;
  const newMin = newExtraction.minFiles;
  if (oldMin !== newMin) {
    if (typeof oldMin === 'number' && typeof newMin === 'number') {
      const lowered = newMin < oldMin;
      add(result, lowered ? 'relaxation' : 'tightening', `extraction minFiles ${lowered ? 'lowered' : 'raised'}: ${String(oldMin)} -> ${String(newMin)}`);
    } else add(result, 'unknown', 'extraction minFiles changed across an unspecified default');
  }
  const configurationKeys = ['profile', 'paths', 'guardSymbols', 'forbiddenImports', 'forbiddenEgressHosts', 'governedModules'] as const;
  const changed = configurationKeys.filter((key) => !equal(oldExtraction[key], newExtraction[key]));
  if (changed.length > 0) add(result, 'unknown', `extractor profile/configuration changed: ${changed.join(', ')}`);
  changedUnknownFields(
    result,
    oldExtraction,
    newExtraction,
    new Set(['profile', 'paths', 'guardSymbols', 'forbiddenImports', 'forbiddenEgressHosts', 'governedModules', 'minFiles']),
    'extractor configuration',
  );
}

function parseSemver(value: unknown): readonly [number, number, number] | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function compareMinimumEngine(result: Evidence, before: unknown, after: unknown): void {
  if (before === after) return;
  if (before !== undefined && after === undefined) {
    add(result, 'relaxation', 'minimum engine version removed');
    return;
  }
  if (before === undefined && after !== undefined) {
    add(result, parseSemver(after) ? 'tightening' : 'unknown', 'minimum engine version added');
    return;
  }
  const oldVersion = parseSemver(before);
  const newVersion = parseSemver(after);
  if (!oldVersion || !newVersion) {
    add(result, 'unknown', 'minimum engine version changed with an invalid value');
    return;
  }
  const direction = compareSemver(newVersion, oldVersion);
  if (direction === 0) add(result, 'unknown', 'minimum engine version changed without a provable direction');
  else add(result, direction < 0 ? 'relaxation' : 'tightening', `minimum engine version ${direction < 0 ? 'lowered' : 'raised'}: ${String(before)} -> ${String(after)}`);
}

function compareMetadata(result: Evidence, before: JsonObject, after: JsonObject): void {
  if (!isObject(before.metadata) || !isObject(after.metadata)) {
    if (!equal(before.metadata, after.metadata)) add(result, 'unknown', 'blueprint metadata changed with an invalid or unsupported shape');
    return;
  }
  const oldMetadata = before.metadata;
  const newMetadata = after.metadata;
  if (oldMetadata.id !== newMetadata.id) add(result, 'unknown', 'blueprint identity changed');
  if (oldMetadata.status !== newMetadata.status) {
    if (oldMetadata.status === 'approved' && newMetadata.status !== 'approved') {
      add(result, 'relaxation', `approved blueprint status weakened: approved -> ${String(newMetadata.status)}`);
    } else if (oldMetadata.status !== 'approved' && newMetadata.status === 'approved') {
      add(result, 'tightening', `blueprint status advanced to approved from ${String(oldMetadata.status)}`);
    } else add(result, 'unknown', `blueprint lifecycle status changed: ${String(oldMetadata.status)} -> ${String(newMetadata.status)}`);
  }
  for (const role of ['ownerRole', 'stewardRole'] as const) {
    if (oldMetadata[role] === newMetadata[role]) continue;
    if (oldMetadata[role] !== undefined) add(result, 'relaxation', `blueprint ${role} requirement removed or changed`);
    else add(result, 'tightening', `blueprint ${role} requirement added`);
  }
  changedUnknownFields(result, oldMetadata, newMetadata, new Set(['id', 'status', 'ownerRole', 'stewardRole', 'name', 'version']), 'blueprint metadata');
}

function blueprintDirection(before: ParsedJson, after: ParsedJson): Evidence {
  const result = evidence();
  if (before.state === 'missing') {
    add(result, 'unknown', 'blueprint policy created; no prior policy exists for semantic comparison');
    if (after.state !== 'value') add(result, 'unknown', 'created blueprint is not valid JSON object data');
    return result;
  }
  if (after.state === 'missing') {
    add(result, 'relaxation', 'blueprint policy deleted');
    if (before.state !== 'value') add(result, 'unknown', 'deleted blueprint was not valid JSON object data');
    return result;
  }
  if (before.state !== 'value' || after.state !== 'value') {
    add(result, 'unknown', 'blueprint comparison contains invalid JSON object data');
    return result;
  }
  if (equal(before.value, after.value)) return result;
  compareMetadata(result, before.value, after.value);
  compareScope(result, before.value, after.value);
  compareConstraints(result, before.value, after.value);
  compareEvidenceRequirements(result, before.value, after.value);
  compareApprovals(result, before.value, after.value);
  compareExtraction(result, before.value, after.value);
  compareMinimumEngine(result, before.value.minEngineVersion, after.value.minEngineVersion);
  for (const key of ['apiVersion', 'kind', 'intentRefs', 'architecture', 'evolution'] as const) {
    if (!equal(before.value[key], after.value[key])) add(result, 'unknown', `blueprint ${key} changed`);
  }
  changedUnknownFields(
    result,
    before.value,
    after.value,
    new Set([
      'apiVersion', 'kind', 'metadata', 'intentRefs', 'scope', 'architecture', 'constraints',
      'evidenceRequirements', 'approvals', 'extraction', 'minEngineVersion', 'evolution',
    ]),
    'blueprint',
  );
  return result;
}

function baselineDirection(before: ParsedJson, after: ParsedJson): Evidence {
  const result = evidence();
  if (before.state === 'missing') {
    add(result, 'relaxation', 'baseline created');
    if (after.state !== 'value') add(result, 'unknown', 'created baseline is not valid JSON object data');
    return result;
  }
  if (after.state === 'missing') {
    add(result, 'tightening', 'baseline removed; all violations become enforced');
    if (before.state !== 'value') add(result, 'unknown', 'removed baseline was not valid JSON object data');
    return result;
  }
  if (before.state !== 'value' || after.state !== 'value') {
    add(result, 'unknown', 'baseline comparison contains invalid JSON object data');
    return result;
  }
  if (equal(before.value, after.value)) return result;
  const oldEntries = indexByString(before.value.entries, 'id', 'baseline entries', result);
  const newEntries = indexByString(after.value.entries, 'id', 'baseline entries', result);
  if (oldEntries && newEntries) {
    const added = sortedDifference(new Set(newEntries.keys()), new Set(oldEntries.keys()));
    const removed = sortedDifference(new Set(oldEntries.keys()), new Set(newEntries.keys()));
    if (added.length > 0) add(result, 'relaxation', `baseline entries added: ${added.join(', ')}`);
    if (removed.length > 0) add(result, 'tightening', `baseline entries removed: ${removed.join(', ')}`);
    for (const id of [...oldEntries.keys()].filter((value) => newEntries.has(value)).sort()) {
      if (!equal(oldEntries.get(id), newEntries.get(id))) add(result, 'unknown', `baseline entry content changed: ${id}`);
    }
  }
  changedUnknownFields(result, before.value, after.value, new Set(['entries']), 'baseline');
  return result;
}

function modeDirection(before: ParsedJson, after: ParsedJson): Evidence {
  const result = evidence();
  if (before.state !== 'value' || after.state !== 'value') {
    if (before.state !== 'missing' || after.state !== 'missing') add(result, 'unknown', 'enforcement-mode policy was added, removed, or is invalid');
    return result;
  }
  if (equal(before.value, after.value)) return result;
  if (before.value.mode === 'enforced' && after.value.mode === 'advisory') add(result, 'relaxation', 'mode changed enforced -> advisory');
  else if (before.value.mode === 'advisory' && after.value.mode === 'enforced') add(result, 'tightening', 'mode changed advisory -> enforced');
  else if (before.value.mode !== after.value.mode) add(result, 'unknown', `enforcement mode changed with an invalid or unsupported value: ${String(before.value.mode)} -> ${String(after.value.mode)}`);
  changedUnknownFields(result, before.value, after.value, new Set(['mode']), 'enforcement-mode policy');
  return result;
}

function enginePinDirection(before: ParsedJson, after: ParsedJson): Evidence {
  const result = evidence();
  if (before.state === 'missing' || after.state === 'missing') {
    add(result, before.state === 'value' ? 'relaxation' : 'unknown', before.state === 'value' ? 'engine pin removed' : 'engine pin created');
    return result;
  }
  if (before.state !== 'value' || after.state !== 'value') {
    add(result, 'unknown', 'engine-pin comparison contains invalid JSON object data');
    return result;
  }
  if (equal(before.value, after.value)) return result;
  if (before.value.range === false && after.value.range !== false) add(result, 'relaxation', 'exact engine pin changed to a range or unspecified pin');
  if (before.value.published === true && after.value.published !== true) add(result, 'relaxation', 'published engine trust anchor disabled');
  for (const key of new Set([...Object.keys(before.value), ...Object.keys(after.value)])) {
    if (!equal(before.value[key], after.value[key]) && key !== 'range' && key !== 'published') add(result, 'unknown', `engine-pin field changed: ${key}`);
  }
  return result;
}

function codeownersDirection(before: string | undefined, after: string | undefined): Evidence {
  const result = evidence();
  if (before === after) return result;
  if (before === undefined && after !== undefined) add(result, 'tightening', 'CODEOWNERS protection added');
  else if (before !== undefined && after === undefined) add(result, 'relaxation', 'CODEOWNERS protection removed');
  else {
    // GitHub applies last matching rule and the complete grammar includes escaping and platform
    // limitations. A set comparison can misclassify an overriding rule as a tightening, so edits
    // to an existing file are deliberately fail-closed until a full provider parser is available.
    add(result, 'unknown', 'CODEOWNERS rules changed; last-match ownership direction is not proven');
  }
  return result;
}

function genericProtectedDirection(file: FileChange, surface: string, before: ParsedJson, after: ParsedJson): Evidence {
  const result = evidence();
  if (file.before === file.after) return result;
  if (before.state === 'value' && after.state === 'value' && equal(before.value, after.value)) return result;
  if (file.after === undefined) add(result, 'relaxation', `${surface} deleted`);
  else add(result, 'unknown', `${surface} changed; semantic non-weakening was not proven`);
  return result;
}

function classifyFile(file: FileChange): ClassifiedChange {
  const rel = normalizePath(file.path);
  const surface = protectedSurface(rel);
  if (!surface) return { path: rel, classification: 'neutral', reasons: ['non-policy path'], approvalBlocked: false };
  const before = parseObject(file.before);
  const after = parseObject(file.after);
  let direction: Evidence;
  if (rel === '.blueprints/baseline.json') direction = baselineDirection(before, after);
  else if (/\.blueprint\.json$/.test(rel)) direction = blueprintDirection(before, after);
  else if (rel === '.bce-mode.json') direction = modeDirection(before, after);
  else if (rel === '.engine-pin.json') direction = enginePinDirection(before, after);
  else if (rel === 'CODEOWNERS' || rel === '.github/CODEOWNERS') direction = codeownersDirection(file.before, file.after);
  else direction = genericProtectedDirection(file, surface, before, after);
  const classification = classify(direction);
  return {
    path: rel,
    classification,
    reasons: classification === 'neutral' ? reasonsFor(direction, classification) : [`protected ${surface} changed`, ...reasonsFor(direction, classification)],
    approvalBlocked: direction.unknown.length > 0,
  };
}

/** Conservative deterministic classifier. There is intentionally no approve-anyway input. */
export function classifyPolicyChanges(files: readonly FileChange[]): PolicyChangeReport {
  const changes = files.map(classifyFile);
  const classification = changes.reduce<PolicyChangeClass>(
    (current, change) => REPORT_RANK[change.classification] > REPORT_RANK[current] ? change.classification : current,
    'neutral',
  );
  return {
    schemaVersion: '1',
    classification,
    humanOwnerReviewRequired: classification !== 'neutral',
    approvalBlocked: changes.some((change) => change.approvalBlocked),
    changes,
  };
}
