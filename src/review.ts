/** Pure, deterministic implementation of the AI-first blueprint review core. */
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { ArchitectureGraph } from './graph.js';
import { classifyPolicyChanges, type FileChange } from './policy-change.js';
import { evaluate, stableStringify } from './report.js';
import {
  TYPESCRIPT_MODULE_GRAPH_MIN_ENGINE_VERSION,
  type Approval,
  type Constraint,
  type EngineeringBlueprint,
  parseBlueprint,
} from './schema.js';
import { assessTeeth, ConstraintTeeth, type RefutabilityWitness, type TeethReport } from './teeth.js';
import {
  AuthenticatedReviewerSchema,
  BlueprintDecisionRecordSchema,
  BlueprintDraftPlanSchema,
  BlueprintInspectionSchema,
  BlueprintProposalSchema,
  BlueprintReviewPacketSchema,
  PolicyComparisonSchema,
  ProposalContextSchema,
  ReviewEngineIdentitySchema,
  ReviewExtractorIdentitySchema,
  RepositoryPolicyDiffSchema,
  ReviewToolchainIdentitySchema,
  type AuthenticatedReviewer,
  type BlueprintDecisionRecord,
  type BlueprintDraftPlan,
  type BlueprintInspection,
  type BlueprintProposal,
  type BlueprintReviewPacket,
  type ConstraintReview,
  type PolicyChangeClassification,
  type PolicyComparison,
  type ProposalContext,
  type ReviewEngineIdentity,
  type ReviewExtractorIdentity,
  type ReviewPacketVerification,
  type ReviewToolchainIdentity,
  type RepositoryPolicyDiff,
} from './review-contracts.js';

const sha256Bytes = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');
export const reviewDigest = (value: unknown): string => sha256Bytes(stableStringify(value));
const detached = <T>(value: T): T => JSON.parse(stableStringify(value)) as T;
const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort();
const same = (a: unknown, b: unknown): boolean => stableStringify(a) === stableStringify(b);
const shown = (value: unknown): string => stableStringify(value).trimEnd();
const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function semverBelow(a: string, b: string): boolean {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return (left[index] ?? 0) < (right[index] ?? 0);
  }
  return false;
}

export interface BuildProposalContextInput {
  repository: ProposalContext['repository'];
  files: Array<{ path: string; content: string; mediaType?: string }>;
  humanIntent: string;
  authoritativeIntentRefs: Array<{ ref: string; content: string }>;
  excluded: { paths: string[]; classes: string[] };
}

/** Build a bounded, content-addressed disclosure context from caller-supplied bytes. */
export function buildProposalContext(input: BuildProposalContextInput): ProposalContext {
  const files = input.files
    .map((file) => ({
      path: file.path.replace(/\\/g, '/'),
      content: file.content,
      bytes: Buffer.byteLength(file.content, 'utf8'),
      sha256: sha256Bytes(file.content),
      ...(file.mediaType !== undefined ? { mediaType: file.mediaType } : {}),
    }))
    .sort((a, b) => compareText(a.path, b.path));
  if (new Set(files.map((file) => file.path)).size !== files.length) {
    throw new Error('proposal context contains duplicate file paths');
  }
  const authoritativeIntentRefs = input.authoritativeIntentRefs
    .map((source) => ({ ...source, sha256: sha256Bytes(source.content) }))
    .sort((a, b) => compareText(a.ref, b.ref));
  if (new Set(authoritativeIntentRefs.map((source) => source.ref)).size !== authoritativeIntentRefs.length) {
    throw new Error('proposal context contains duplicate authoritative intent references');
  }
  const body = {
    schemaVersion: '1' as const,
    kind: 'ProposalContext' as const,
    repository: detached(input.repository),
    files,
    humanIntent: input.humanIntent,
    authoritativeIntentRefs,
    excluded: {
      paths: sortedUnique(input.excluded.paths.map((path) => path.replace(/\\/g, '/'))),
      classes: sortedUnique(input.excluded.classes),
    },
  };
  return ProposalContextSchema.parse({ ...body, contextDigest: reviewDigest(body) });
}

function verifyContext(context: ProposalContext): string[] {
  const failures: string[] = [];
  const { contextDigest, ...body } = context;
  if (reviewDigest(body) !== contextDigest) failures.push('context digest mismatch');
  for (const file of context.files) {
    if (sha256Bytes(file.content) !== file.sha256) failures.push(`context file digest mismatch: ${file.path}`);
    if (Buffer.byteLength(file.content, 'utf8') !== file.bytes) failures.push(`context file byte count mismatch: ${file.path}`);
  }
  for (const source of context.authoritativeIntentRefs) {
    if (sha256Bytes(source.content) !== source.sha256) failures.push(`intent reference digest mismatch: ${source.ref}`);
  }
  const filePaths = context.files.map((file) => file.path);
  const intentRefs = context.authoritativeIntentRefs.map((source) => source.ref);
  if (new Set(filePaths).size !== filePaths.length) failures.push('context contains duplicate file paths');
  if (new Set(intentRefs).size !== intentRefs.length) failures.push('context contains duplicate intent references');
  if (!same(filePaths, [...filePaths].sort())) failures.push('context file manifest is not canonical-sorted');
  if (!same(intentRefs, [...intentRefs].sort())) failures.push('context intent references are not canonical-sorted');
  if (!same(context.excluded.paths, sortedUnique(context.excluded.paths))) failures.push('context excluded paths are not canonical-sorted and unique');
  if (!same(context.excluded.classes, sortedUnique(context.excluded.classes))) failures.push('context excluded classes are not canonical-sorted and unique');
  return failures;
}

function verifyPlanAnchors(context: ProposalContext, plan: BlueprintDraftPlan): string[] {
  const failures: string[] = [];
  const fileByPath = new Map(context.files.map((file) => [file.path, file]));
  const intentByRef = new Map(context.authoritativeIntentRefs.map((source) => [source.ref, source]));
  const assertions = [
    ...plan.scope.assertions.map((assertion) => ({ assertion, location: 'scope' })),
    ...plan.clauses.flatMap((clause) =>
      clause.assertions.map((assertion) => ({ assertion, location: `constraint ${clause.constraint.id}` })),
    ),
  ];
  for (const { assertion, location } of assertions) {
    for (const anchor of assertion.anchors) {
      const anchored = anchor.kind === 'repository-file' ? fileByPath.get(anchor.ref) : intentByRef.get(anchor.ref);
      if (anchored === undefined) failures.push(`${location} assertion anchor is outside the disclosed context: ${anchor.ref}`);
      else {
        if (anchored.sha256 !== anchor.sha256) failures.push(`${location} assertion anchor digest mismatch: ${anchor.ref}`);
        const lineCount = anchored.content.length === 0 ? 0 : anchored.content.split(/\r?\n/).length;
        if (anchor.lineStart !== undefined && anchor.lineStart > lineCount) {
          failures.push(`${location} assertion anchor lineStart is outside ${anchor.ref}: ${anchor.lineStart} > ${lineCount}`);
        }
        if (anchor.lineEnd !== undefined && anchor.lineEnd > lineCount) {
          failures.push(`${location} assertion anchor lineEnd is outside ${anchor.ref}: ${anchor.lineEnd} > ${lineCount}`);
        }
      }
    }
    if (assertion.basis === 'observed-fact' && !assertion.anchors.some((anchor) => anchor.kind === 'repository-file')) {
      failures.push(`${location} observed-fact assertion requires a repository-file anchor`);
    }
    if (
      assertion.basis === 'source-backed-intent' &&
      !assertion.anchors.some((anchor) => anchor.kind === 'intent-reference')
    ) {
      failures.push(`${location} source-backed-intent assertion requires an intent-reference anchor`);
    }
  }
  return failures;
}

/** Compile untrusted plan data into an exact draft artifact. No plan can select a stronger status. */
export function compileDraftPlan(args: {
  context: ProposalContext;
  plan: BlueprintDraftPlan;
  promptDigest: string;
  generationDigest: string;
}): BlueprintProposal {
  const context = ProposalContextSchema.parse(detached(args.context));
  const plan = BlueprintDraftPlanSchema.parse(detached(args.plan));
  const contextFailures = verifyContext(context);
  if (contextFailures.length > 0) throw new Error(`invalid proposal context: ${contextFailures.join('; ')}`);
  if (plan.contextDigest !== context.contextDigest) throw new Error('draft plan is bound to a different proposal context');
  if (plan.proposalId !== plan.metadata.id) throw new Error('draft plan proposalId must equal the blueprint metadata id');
  const anchorFailures = verifyPlanAnchors(context, plan);
  if (anchorFailures.length > 0) throw new Error(`invalid draft plan anchors: ${anchorFailures.join('; ')}`);

  // The model proposes policy; it does not own engine-compatibility safety metadata. Keep the
  // AI-first path as frictionless and safe as `bce author`: selecting the module graph
  // deterministically adds its minimum engine floor, while preserving any stricter future pin.
  const minEngineVersion = plan.extraction?.profile === 'typescript-module-graph' &&
    (plan.minEngineVersion === undefined ||
      semverBelow(plan.minEngineVersion, TYPESCRIPT_MODULE_GRAPH_MIN_ENGINE_VERSION))
    ? TYPESCRIPT_MODULE_GRAPH_MIN_ENGINE_VERSION
    : plan.minEngineVersion;

  const candidate = parseBlueprint({
    apiVersion: 'blueprint-conformance/v1alpha1',
    kind: 'EngineeringBlueprint',
    metadata: { ...plan.metadata, status: 'draft' },
    intentRefs: context.authoritativeIntentRefs.map((source) => source.ref),
    scope: {
      repositories: [...plan.scope.repositories],
      ...(plan.scope.paths !== undefined ? { paths: [...plan.scope.paths] } : {}),
      ...(plan.scope.environments !== undefined ? { environments: [...plan.scope.environments] } : {}),
    },
    architecture: detached(plan.architecture),
    constraints: plan.clauses.map((clause) => detached(clause.constraint)),
    evidenceRequirements: detached(plan.evidenceRequirements),
    approvals: detached(plan.approvals),
    ...(plan.extraction !== undefined ? { extraction: detached(plan.extraction) } : {}),
    ...(minEngineVersion !== undefined ? { minEngineVersion } : {}),
  });
  const planDigest = reviewDigest(plan);
  const artifactDigest = reviewDigest(candidate);
  const body = {
    schemaVersion: '1' as const,
    kind: 'BlueprintProposal' as const,
    proposalId: plan.proposalId,
    context,
    plan,
    candidate,
    digests: {
      context: context.contextDigest,
      plan: planDigest,
      prompt: args.promptDigest,
      generation: args.generationDigest,
      artifact: artifactDigest,
    },
  };
  return BlueprintProposalSchema.parse({
    ...body,
    digests: { ...body.digests, proposal: reviewDigest(body) },
  });
}

function verifyProposal(proposal: BlueprintProposal): string[] {
  const failures = verifyContext(proposal.context);
  if (proposal.plan.contextDigest !== proposal.context.contextDigest) failures.push('plan context binding mismatch');
  failures.push(...verifyPlanAnchors(proposal.context, proposal.plan));
  if (proposal.proposalId !== proposal.plan.proposalId) failures.push('proposal id does not match draft plan');
  if (proposal.digests.context !== proposal.context.contextDigest) failures.push('proposal context digest mismatch');
  if (proposal.digests.plan !== reviewDigest(proposal.plan)) failures.push('proposal plan digest mismatch');
  if (proposal.digests.artifact !== reviewDigest(proposal.candidate)) failures.push('proposal artifact digest mismatch');
  if (proposal.candidate.metadata.status !== 'draft') failures.push('proposal candidate is not draft-only');
  const { proposal: ignored, ...digests } = proposal.digests;
  void ignored;
  const body = { ...proposal, digests };
  if (proposal.digests.proposal !== reviewDigest(body)) failures.push('proposal digest mismatch');
  try {
    const recompiled = compileDraftPlan({
      context: proposal.context,
      plan: proposal.plan,
      promptDigest: proposal.digests.prompt,
      generationDigest: proposal.digests.generation,
    });
    if (!same(recompiled.candidate, proposal.candidate)) failures.push('candidate does not reproduce from draft plan');
  } catch (error) {
    failures.push(`proposal does not reproduce: ${(error as Error).message}`);
  }
  return failures;
}

const IMPLEMENTED_TYPES = new Set([
  'requiredDependency',
  'requiredComponent',
  'forbiddenDependency',
  'forbiddenEgress',
  'forbiddenPath',
  'forbiddenFile',
  'forbiddenPattern',
  'behavioralInvariant',
]);

function constraintShapeSupported(constraint: Constraint, graph?: ArchitectureGraph): boolean {
  if (!IMPLEMENTED_TYPES.has(constraint.type)) return false;
  if (constraint.type === 'requiredComponent') return typeof constraint.component === 'string';
  if (constraint.type === 'forbiddenDependency') return typeof constraint.to === 'string';
  if (constraint.type === 'forbiddenPath') return typeof constraint.path === 'string';
  if (constraint.type === 'forbiddenFile') {
    return typeof constraint.path === 'string' && (graph === undefined || graph.coverage.scannedFiles !== undefined);
  }
  if (constraint.type === 'forbiddenPattern') {
    return typeof constraint.pattern === 'string' && (graph === undefined || graph.coverage.patternScan?.patterns.includes(constraint.pattern) === true);
  }
  if (constraint.type === 'forbiddenEgress' && graph?.coverage.extractor === 'line-scan') return false;
  return true;
}

function scopeGlobToRegExp(glob: string): RegExp {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]!;
    if (char === '*') {
      if (glob[index + 1] === '*') {
        index += 1;
        if (glob[index + 1] === '/') {
          source += '(?:.*/)?';
          index += 1;
        } else source += '.*';
      } else source += '[^/]*';
    } else if (char === '?') source += '[^/]';
    else source += '\\^$.|+()[]{}'.includes(char) ? `\\${char}` : char;
  }
  return new RegExp(`^${source}$`);
}

function matchedConstraintScope(constraint: Constraint, files: readonly string[]): string[] {
  const patterns = constraint.scopePaths && constraint.scopePaths.length > 0
    ? constraint.scopePaths
    : (constraint.type === 'forbiddenPath' || constraint.type === 'forbiddenFile' || constraint.type === 'forbiddenPattern') && constraint.path
      ? [constraint.path]
      : [];
  if (patterns.length === 0) return sortedUnique(files);
  const matchers = patterns.map(scopeGlobToRegExp);
  return sortedUnique(files.filter((file) => matchers.some((matcher) => matcher.test(file))));
}

function plainLanguage(constraint: Constraint): string {
  switch (constraint.type) {
    case 'requiredComponent':
      return `Require at least one ${constraint.component ?? '(unspecified)'} component.`;
    case 'requiredDependency':
      return `Require ${constraint.component ?? 'governed'} components to use the governed dependency path.`;
    case 'forbiddenDependency':
      return `Forbid ${constraint.from ?? 'any component'} from importing ${constraint.to ?? '(unspecified dependency)'}.`;
    case 'forbiddenEgress':
      return constraint.governedHosts && constraint.governedHosts.length > 0
        ? `Allow direct egress only to governed hosts: ${constraint.governedHosts.join(', ')}.`
        : `Forbid direct egress to ${[...(constraint.to ? [constraint.to] : []), ...(constraint.forbiddenEgressHosts ?? [])].join(', ') || '(unspecified hosts)'}.`;
    case 'forbiddenPath':
      return `Forbid recognized components under ${constraint.path ?? '(unspecified path)'}.`;
    case 'forbiddenFile':
      return `Forbid files matching ${constraint.path ?? '(unspecified path)'}.`;
    case 'forbiddenPattern':
      return `Forbid content matching /${constraint.pattern ?? ''}/${constraint.path ? ` under ${constraint.path}` : ''}.`;
    case 'behavioralInvariant':
      return `Require runtime behavior ${constraint.behaviorRef ?? '(unspecified)'} to vary with stimuli and satisfy its oracle.`;
    case 'requiredEvidence':
      return `Require evidence of type ${constraint.evidenceType ?? '(unspecified)'}.`;
    case 'minimumMetric':
      return `Require metric ${constraint.metric ?? '(unspecified)'} to meet ${constraint.minimum ?? '(unspecified)'}.`;
    case 'customPolicy':
      return `Apply custom policy ${constraint.policyRef ?? '(unspecified)'}.`;
  }
}

/** Explain one clause through the invariant Promise / Lens / Proof / Limits grammar. */
export function explainConstraint(args: {
  constraint: Constraint;
  blueprint: EngineeringBlueprint;
  graph?: ArchitectureGraph;
  teethWitness?: RefutabilityWitness;
  matchedScope?: string[];
  knownBlindSpots?: string[];
}): ConstraintReview {
  const { constraint, blueprint, graph } = args;
  const matchedScope = matchedConstraintScope(
    constraint,
    args.matchedScope ?? graph?.coverage.scannedFiles ?? [],
  );
  const supported = constraintShapeSupported(constraint, graph);
  const teeth = args.teethWitness?.verdict ?? 'not-assessed';
  const gradeability: ConstraintReview['proof']['gradeability'] = !supported
    ? 'unsupported'
    : graph === undefined
      ? 'indeterminate'
      : teeth === ConstraintTeeth.INDETERMINATE
        ? 'indeterminate'
        : 'graded';
  const limits = sortedUnique([
    ...(graph?.coverage.unsupported ?? ['No observed graph was supplied; gradeability and matched scope are unverified.']),
    ...(constraint.type === 'forbiddenPath'
      ? ['This clause sees recognized components, not every raw file; use forbiddenFile for raw-file coverage.']
      : []),
    ...(constraint.type === 'behavioralInvariant'
      ? ['This clause requires served-runtime observations; a static source scan alone cannot prove it.']
      : []),
    ...(!supported ? [`Constraint type or arguments are not implemented by this evaluator: ${constraint.type}.`] : []),
    ...(args.teethWitness?.verdict === ConstraintTeeth.EVALUATOR_REFUTABLE
      ? ['The mutation proves evaluator refutability only; it is not extractor-real evidence.']
      : []),
    ...(args.teethWitness?.verdict === ConstraintTeeth.TRIVIALLY_GREEN
      ? ['No realistic mutation made this clause fail in the assessed frame.']
      : []),
    ...(args.knownBlindSpots ?? []),
  ]);
  const scope = blueprint.extraction?.paths ?? blueprint.scope.paths ?? [];
  const language = plainLanguage(constraint);
  return {
    constraintId: constraint.id,
    type: constraint.type,
    severity: constraint.severity,
    canonicalJson: stableStringify(constraint),
    plainLanguage: language,
    promise: `${language.slice(0, -1)} as an enforceable ${constraint.severity}-severity architectural promise.`,
    lens: {
      summary: `The ${blueprint.extraction?.profile ?? 'next-route-handler'} extractor observes ${scope.length > 0 ? scope.join(', ') : 'the declared repository surface'}.`,
      matchedScope,
    },
    proof: {
      gradeability,
      teeth,
      summary: args.teethWitness?.mutation ?? 'No mutation-refutability assessment was supplied.',
    },
    limits: limits.length > 0 ? limits : ['No additional evaluator limit was reported for this clause.'],
  };
}

/** Produce the renderer-independent, human-oriented contract view. */
export function inspectBlueprint(args: {
  blueprint: EngineeringBlueprint;
  graph?: ArchitectureGraph;
  teeth?: TeethReport;
  plan?: BlueprintDraftPlan;
  resolvedScope?: { matchedFiles: string[]; excludedPaths?: string[]; excludedClasses?: string[] };
}): BlueprintInspection {
  const blueprint = parseBlueprint(detached(args.blueprint));
  const witnessById = new Map(args.teeth?.witnesses.map((witness) => [witness.constraintId, witness]));
  const planClauseById = new Map(args.plan?.clauses.map((clause) => [clause.constraint.id, clause]));
  const matchedFiles = sortedUnique(args.resolvedScope?.matchedFiles ?? args.graph?.coverage.scannedFiles ?? []);
  const clauses = blueprint.constraints.map((constraint) => {
    const witness = witnessById.get(constraint.id);
    return explainConstraint({
      constraint,
      blueprint,
      ...(args.graph !== undefined ? { graph: args.graph } : {}),
      ...(witness !== undefined ? { teethWitness: witness } : {}),
      matchedScope: matchedFiles,
      knownBlindSpots: sortedUnique(
        planClauseById.get(constraint.id)?.assertions.flatMap((assertion) => assertion.knownBlindSpots) ?? [],
      ),
    });
  });
  return BlueprintInspectionSchema.parse({
    schemaVersion: '1',
    blueprintRef: `${blueprint.metadata.id}@${blueprint.metadata.version}`,
    intent: blueprint.intentRefs,
    plainLanguageContract: `${blueprint.metadata.name ?? blueprint.metadata.id} contains ${clauses.length} draft architectural clause(s) over ${blueprint.scope.repositories.join(', ')}.`,
    resolvedScope: {
      repositories: sortedUnique(blueprint.scope.repositories),
      declaredPaths: sortedUnique(blueprint.extraction?.paths ?? blueprint.scope.paths ?? []),
      matchedFiles,
      excludedPaths: sortedUnique(args.resolvedScope?.excludedPaths ?? []),
      excludedClasses: sortedUnique(args.resolvedScope?.excludedClasses ?? []),
    },
    clauses,
    unsupportedCoverage: sortedUnique([
      ...(args.graph?.coverage.unsupported ?? []),
      ...(args.plan?.knownBlindSpots ?? []),
      ...(args.plan?.scope.assertions.flatMap((assertion) => assertion.knownBlindSpots) ?? []),
    ]),
  });
}

type Change = PolicyComparison['changes'][number];
const severityRank: Record<Constraint['severity'], number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function addChange(
  changes: Change[],
  path: string,
  classification: PolicyChangeClassification,
  summary: string,
  before?: unknown,
  after?: unknown,
): void {
  changes.push({
    path,
    classification,
    summary,
    ...(before !== undefined ? { before: shown(before) } : {}),
    ...(after !== undefined ? { after: shown(after) } : {}),
  });
}

function compareStringSets(
  changes: Change[],
  path: string,
  before: readonly string[],
  after: readonly string[],
  removal: PolicyChangeClassification,
  addition: PolicyChangeClassification,
): void {
  const b = new Set(before);
  const a = new Set(after);
  for (const value of [...b].filter((item) => !a.has(item)).sort()) {
    addChange(changes, `${path}/${value}`, removal, `removed ${value}`, value, undefined);
  }
  for (const value of [...a].filter((item) => !b.has(item)).sort()) {
    addChange(changes, `${path}/${value}`, addition, `added ${value}`, undefined, value);
  }
}

function compareOptionalScope(
  changes: Change[],
  path: string,
  before: readonly string[] | undefined,
  after: readonly string[] | undefined,
): void {
  if (same(before, after)) return;
  if (before === undefined && after !== undefined) {
    addChange(changes, path, 'relaxation', 'changed an unbounded scope to a bounded scope', before, after);
  } else if (before !== undefined && after === undefined) {
    addChange(changes, path, 'tightening', 'removed the scope bound', before, after);
  } else {
    compareStringSets(changes, path, before ?? [], after ?? [], 'relaxation', 'tightening');
  }
}

const KNOWN_CONSTRAINT_KEYS = new Set([
  'id', 'type', 'severity', 'from', 'to', 'component', 'path', 'scopePaths', 'evidenceType', 'metric',
  'minimum', 'policyRef', 'governedHosts', 'egressCallees', 'forbiddenEgressHosts', 'behaviorRef',
  'probeDefinitionHash', 'stimulusSetHash', 'environmentId', 'pattern',
]);

function compareConstraint(changes: Change[], before: Constraint, after: Constraint): void {
  const root = `/constraints/${before.id}`;
  if (before.type !== after.type) {
    addChange(changes, `${root}/type`, 'unknown-potential-relaxation', 'constraint type changed', before.type, after.type);
    return;
  }
  const beforeRank = severityRank[before.severity];
  const afterRank = severityRank[after.severity];
  if (beforeRank !== afterRank) {
    addChange(
      changes,
      `${root}/severity`,
      afterRank < beforeRank ? 'relaxation' : 'tightening',
      afterRank < beforeRank ? 'constraint severity lowered' : 'constraint severity raised',
      before.severity,
      after.severity,
    );
  }
  if (before.type === 'forbiddenEgress') {
    compareStringSets(changes, `${root}/governedHosts`, before.governedHosts ?? [], after.governedHosts ?? [], 'tightening', 'relaxation');
    compareStringSets(changes, `${root}/forbiddenEgressHosts`, before.forbiddenEgressHosts ?? [], after.forbiddenEgressHosts ?? [], 'relaxation', 'tightening');
  }
  if (before.type === 'forbiddenDependency') {
    compareOptionalScope(changes, `${root}/scopePaths`, before.scopePaths, after.scopePaths);
  }
  const handled = new Set(['id', 'type', 'severity']);
  if (before.type === 'forbiddenEgress') {
    handled.add('governedHosts');
    handled.add('forbiddenEgressHosts');
  }
  if (before.type === 'forbiddenDependency') handled.add('scopePaths');
  const keys = sortedUnique([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (handled.has(key) || same(before[key], after[key])) continue;
    const known = KNOWN_CONSTRAINT_KEYS.has(key);
    addChange(
      changes,
      `${root}/${key}`,
      'unknown-potential-relaxation',
      known ? `constraint argument '${key}' changed with directionally ambiguous policy effect` : `unknown constraint field '${key}' changed`,
      before[key],
      after[key],
    );
  }
}

function compareEvidence(changes: Change[], before: EngineeringBlueprint, after: EngineeringBlueprint): void {
  const key = (item: EngineeringBlueprint['evidenceRequirements'][number]): string => item.type;
  const b = new Map(before.evidenceRequirements.map((item) => [key(item), item]));
  const a = new Map(after.evidenceRequirements.map((item) => [key(item), item]));
  for (const type of sortedUnique([...b.keys(), ...a.keys()])) {
    const old = b.get(type);
    const next = a.get(type);
    if (!old && next) {
      addChange(changes, `/evidenceRequirements/${type}`, 'tightening', 'required evidence rule added', undefined, next);
      continue;
    }
    if (old && !next) {
      addChange(changes, `/evidenceRequirements/${type}`, 'relaxation', 'required evidence rule removed', old, undefined);
      continue;
    }
    if (!old || !next) continue;
    if (old.required !== next.required) {
      addChange(changes, `/evidenceRequirements/${type}/required`, next.required ? 'tightening' : 'relaxation', next.required ? 'evidence made required' : 'evidence made optional', old.required, next.required);
    }
    const missingRank = { warn: 0, unknown: 1, block: 2 } as const;
    if (old.onMissing !== next.onMissing) {
      const oldRank = old.onMissing === undefined ? 1 : missingRank[old.onMissing];
      const nextRank = next.onMissing === undefined ? 1 : missingRank[next.onMissing];
      addChange(changes, `/evidenceRequirements/${type}/onMissing`, nextRank < oldRank ? 'relaxation' : nextRank > oldRank ? 'tightening' : 'neutral', 'missing-evidence handling changed', old.onMissing, next.onMissing);
    }
    if (old.freshnessSeconds !== next.freshnessSeconds) {
      const oldValue = old.freshnessSeconds ?? Number.POSITIVE_INFINITY;
      const nextValue = next.freshnessSeconds ?? Number.POSITIVE_INFINITY;
      addChange(changes, `/evidenceRequirements/${type}/freshnessSeconds`, nextValue > oldValue ? 'relaxation' : 'tightening', 'evidence freshness bound changed', old.freshnessSeconds, next.freshnessSeconds);
    }
    if (old.minimumCoverage !== next.minimumCoverage) {
      const oldValue = old.minimumCoverage ?? 0;
      const nextValue = next.minimumCoverage ?? 0;
      addChange(changes, `/evidenceRequirements/${type}/minimumCoverage`, nextValue < oldValue ? 'relaxation' : 'tightening', 'minimum evidence coverage changed', old.minimumCoverage, next.minimumCoverage);
    }
    const known = new Set(['type', 'required', 'onMissing', 'freshnessSeconds', 'minimumCoverage']);
    for (const field of sortedUnique([...Object.keys(old), ...Object.keys(next)])) {
      if (!known.has(field) && !same(old[field], next[field])) {
        addChange(changes, `/evidenceRequirements/${type}/${field}`, 'unknown-potential-relaxation', `evidence argument '${field}' changed`, old[field], next[field]);
      }
    }
  }
}

function approvalKey(approval: Approval): string {
  return `${approval.role}\0${approval.stage}`;
}

const PROTECTED_POLICY_PATHS = [
  /^\.blueprints\//,
  /^\.bce-/,
  /^\.engine-pin\.json$/,
  /^\.github\/workflows\//,
  /^skills\//,
  /^spec\/schemas\//,
  /^src\/(?:schema|report|teeth|gate|policy-change|mcp-server)\.ts$/,
  /(?:^|\/)AGENTS\.md$/,
  /(?:^|\/)package\.json$/,
];

/** Conservative semantic comparison. Directionally ambiguous edits block approval. */
export function compareBlueprintPolicy(args: {
  baseBlueprint: EngineeringBlueprint | null;
  candidateBlueprint: EngineeringBlueprint;
  files?: readonly FileChange[];
}): PolicyComparison {
  const candidate = parseBlueprint(detached(args.candidateBlueprint));
  const base = args.baseBlueprint === null ? null : parseBlueprint(detached(args.baseBlueprint));
  const changes: Change[] = [];
  let delegatedApprovalBlocked = false;
  if (base === null) {
    addChange(changes, '/', 'tightening', 'new governed blueprint introduced', undefined, candidate.metadata.id);
  } else {
    if (base.metadata.id !== candidate.metadata.id) {
      addChange(changes, '/metadata/id', 'unknown-potential-relaxation', 'blueprint identity changed', base.metadata.id, candidate.metadata.id);
    }
    compareStringSets(changes, '/scope/repositories', base.scope.repositories, candidate.scope.repositories, 'relaxation', 'tightening');
    compareOptionalScope(changes, '/scope/paths', base.scope.paths, candidate.scope.paths);
    compareStringSets(changes, '/scope/environments', base.scope.environments ?? [], candidate.scope.environments ?? [], 'relaxation', 'tightening');

    const oldConstraints = new Map(base.constraints.map((constraint) => [constraint.id, constraint]));
    const nextConstraints = new Map(candidate.constraints.map((constraint) => [constraint.id, constraint]));
    for (const id of sortedUnique([...oldConstraints.keys(), ...nextConstraints.keys()])) {
      const old = oldConstraints.get(id);
      const next = nextConstraints.get(id);
      if (old && !next) addChange(changes, `/constraints/${id}`, 'relaxation', 'constraint removed', old, undefined);
      else if (!old && next) addChange(changes, `/constraints/${id}`, 'tightening', 'constraint added', undefined, next);
      else if (old && next) compareConstraint(changes, old, next);
    }

    compareEvidence(changes, base, candidate);
    compareStringSets(changes, '/approvals', base.approvals.map(approvalKey), candidate.approvals.map(approvalKey), 'relaxation', 'tightening');

    const oldExtraction = base.extraction;
    const nextExtraction = candidate.extraction;
    if ((oldExtraction?.profile ?? 'next-route-handler') !== (nextExtraction?.profile ?? 'next-route-handler')) {
      addChange(changes, '/extraction/profile', 'unknown-potential-relaxation', 'extractor profile changed', oldExtraction?.profile, nextExtraction?.profile);
    }
    compareOptionalScope(changes, '/extraction/paths', oldExtraction?.paths, nextExtraction?.paths);
    const oldMin = oldExtraction?.minFiles;
    const nextMin = nextExtraction?.minFiles;
    if (oldMin !== nextMin) {
      const oldValue = oldMin ?? 0;
      const nextValue = nextMin ?? 0;
      addChange(changes, '/extraction/minFiles', nextValue < oldValue ? 'relaxation' : 'tightening', 'minimum scanned-file floor changed', oldMin, nextMin);
    }
    for (const field of ['guardSymbols', 'forbiddenImports', 'forbiddenEgressHosts', 'governedModules'] as const) {
      if (!same(oldExtraction?.[field], nextExtraction?.[field])) {
        addChange(changes, `/extraction/${field}`, 'unknown-potential-relaxation', `extractor configuration '${field}' changed`, oldExtraction?.[field], nextExtraction?.[field]);
      }
    }
    if (!same(base.architecture, candidate.architecture)) {
      addChange(changes, '/architecture', 'unknown-potential-relaxation', 'intended architecture changed', base.architecture, candidate.architecture);
    }
    if (!same(base.intentRefs, candidate.intentRefs)) {
      addChange(changes, '/intentRefs', 'unknown-potential-relaxation', 'authoritative intent references changed', base.intentRefs, candidate.intentRefs);
    }
    if (base.minEngineVersion !== candidate.minEngineVersion) {
      if (base.minEngineVersion === undefined) addChange(changes, '/minEngineVersion', 'tightening', 'minimum engine version added', undefined, candidate.minEngineVersion);
      else if (candidate.minEngineVersion === undefined) addChange(changes, '/minEngineVersion', 'relaxation', 'minimum engine version removed', base.minEngineVersion, undefined);
      else addChange(changes, '/minEngineVersion', 'unknown-potential-relaxation', 'minimum engine version changed', base.minEngineVersion, candidate.minEngineVersion);
    }
    if (!same(base.evolution, candidate.evolution)) {
      addChange(changes, '/evolution', 'unknown-potential-relaxation', 'policy evolution metadata changed', base.evolution, candidate.evolution);
    }

    // The canonical repository-level A5 classifier is the security oracle for blueprint files.
    // Keep the detailed review changes above for human legibility, but never let this projection
    // classify a mutation as safer than the canonical gate.
    const landingCandidate = parseBlueprint({
      ...candidate,
      metadata: { ...candidate.metadata, status: base.metadata.status },
    });
    const canonical = classifyPolicyChanges([{
      path: `.blueprints/${base.metadata.id}.blueprint.json`,
      before: stableStringify(base),
      // Draft is a proposal-state authority boundary, not a policy relaxation: attended landing
      // restores the existing lifecycle status. Compare the exact landing projection here.
      after: stableStringify(landingCandidate),
    }]);
    delegatedApprovalBlocked = canonical.approvalBlocked;
    const canonicalChange = canonical.changes[0];
    if (canonicalChange && canonicalChange.classification !== 'neutral') {
      addChange(
        changes,
        '/semantic-change-gate',
        canonicalChange.classification,
        canonicalChange.reasons.join('; '),
      );
    }
  }

  if (args.files && args.files.length > 0) {
    const existing = classifyPolicyChanges(args.files);
    delegatedApprovalBlocked ||= existing.approvalBlocked;
    for (const change of existing.changes) {
      const rel = change.path.replace(/^\.\//, '');
      const protectedPath = PROTECTED_POLICY_PATHS.some((pattern) => pattern.test(rel));
      if (change.classification !== 'neutral') {
        addChange(changes, `/files/${rel}`, change.classification, change.reasons.join('; '), change.path, undefined);
      } else if (protectedPath && args.files.find((file) => file.path.replace(/^\.\//, '').replace(/\\/g, '/') === rel)?.before !== args.files.find((file) => file.path.replace(/^\.\//, '').replace(/\\/g, '/') === rel)?.after) {
        addChange(changes, `/files/${rel}`, 'unknown-potential-relaxation', 'protected policy surface changed; semantic direction is not proven', change.path, undefined);
      }
    }
  }

  changes.sort((a, b) => {
    const keyA = `${a.path}\0${a.classification}\0${a.summary}`;
    const keyB = `${b.path}\0${b.classification}\0${b.summary}`;
    return compareText(keyA, keyB);
  });
  const classification: PolicyChangeClassification = changes.some((change) => change.classification === 'unknown-potential-relaxation')
    ? 'unknown-potential-relaxation'
    : changes.some((change) => change.classification === 'relaxation')
      ? 'relaxation'
      : changes.some((change) => change.classification === 'tightening')
        ? 'tightening'
        : 'neutral';
  return PolicyComparisonSchema.parse({
    schemaVersion: '1',
    classification,
    blocksApproval: classification === 'unknown-potential-relaxation' || delegatedApprovalBlocked,
    changes,
  });
}

function reviewPacketBody(packet: BlueprintReviewPacket): Omit<BlueprintReviewPacket, 'packetDigest'> {
  const { packetDigest, ...body } = packet;
  void packetDigest;
  return body;
}

/** Build a deterministic review packet and replay the evaluator/teeth proof automatically. */
export function buildReviewPacket(args: {
  proposal: BlueprintProposal;
  baseBlueprint: EngineeringBlueprint | null;
  graph: ArchitectureGraph;
  engine: ReviewEngineIdentity;
  extractor: ReviewExtractorIdentity;
  toolchain: ReviewToolchainIdentity;
  repositoryPolicyDiff: RepositoryPolicyDiff;
  resolvedScope?: { matchedFiles: string[]; excludedPaths?: string[]; excludedClasses?: string[] };
}): BlueprintReviewPacket {
  const proposal = BlueprintProposalSchema.parse(detached(args.proposal));
  const proposalFailures = verifyProposal(proposal);
  if (proposalFailures.length > 0) throw new Error(`invalid blueprint proposal: ${proposalFailures.join('; ')}`);
  const baseBlueprint = args.baseBlueprint === null ? null : parseBlueprint(detached(args.baseBlueprint));
  const graph = detached(args.graph);
  const engine = ReviewEngineIdentitySchema.parse(detached(args.engine));
  const extractor = ReviewExtractorIdentitySchema.parse(detached(args.extractor));
  const toolchain = ReviewToolchainIdentitySchema.parse(detached(args.toolchain));
  const repositoryPolicyDiff = RepositoryPolicyDiffSchema.parse(detached(args.repositoryPolicyDiff));
  if (proposal.context.repository.identity !== proposal.candidate.scope.repositories[0] && !proposal.candidate.scope.repositories.includes(proposal.context.repository.identity)) {
    throw new Error('candidate scope does not include the proposal-context repository identity');
  }
  if (graph.ctRepoRevision !== proposal.context.repository.revision) {
    throw new Error('observed graph revision does not match proposal-context repository revision');
  }
  if (graph.coverage.extractor !== extractor.kind) throw new Error('observed graph extractor kind does not match review identity');
  if ((proposal.candidate.extraction?.profile ?? 'next-route-handler') !== extractor.profile) {
    throw new Error('candidate extraction profile does not match review identity');
  }

  const conformance = evaluate(proposal.candidate, graph, extractor.profile, proposal.context.repository.identity);
  const proof = assessTeeth(proposal.candidate, graph, extractor.profile);
  const resolvedScope = {
    matchedFiles: args.resolvedScope?.matchedFiles ?? graph.coverage.scannedFiles ?? [],
    excludedPaths: args.resolvedScope?.excludedPaths ?? proposal.context.excluded.paths,
    excludedClasses: args.resolvedScope?.excludedClasses ?? proposal.context.excluded.classes,
  };
  const contract = inspectBlueprint({ blueprint: proposal.candidate, graph, teeth: proof, plan: proposal.plan, resolvedScope });
  const semanticDiff = compareBlueprintPolicy({
    baseBlueprint,
    candidateBlueprint: proposal.candidate,
    files: repositoryPolicyDiff.files.map((file) => ({
      path: file.path,
      ...(file.before !== undefined ? { before: file.before } : {}),
      ...(file.after !== undefined ? { after: file.after } : {}),
    })),
  });
  const blockers = sortedUnique([
    ...(!repositoryPolicyDiff.complete ? ['Repository policy diff has no trustworthy base revision.'] : []),
    ...(proposal.candidate.approvals.length > 1 ? ['Multiple approval requirements need an aggregate authenticated-decision flow.'] : []),
    ...(semanticDiff.blocksApproval ? ['Semantic comparison is unknown-potential-relaxation.'] : []),
    ...contract.clauses
      .filter((clause) => clause.proof.gradeability !== 'graded')
      .map((clause) => `Constraint ${clause.constraintId} is ${clause.proof.gradeability}.`),
    ...proof.witnesses
      .filter((witness) => witness.verdict !== ConstraintTeeth.TOOTHED)
      .map((witness) =>
        witness.verdict === ConstraintTeeth.EVALUATOR_REFUTABLE
          ? `Constraint ${witness.constraintId} has evaluator-only refutability, not extractor-real proof.`
          : `Constraint ${witness.constraintId} has ${witness.verdict} proof.`,
      ),
  ]);
  const provenance = {
    contextDigest: proposal.digests.context,
    planDigest: proposal.digests.plan,
    promptDigest: proposal.digests.prompt,
    generationDigest: proposal.digests.generation,
    proposalDigest: proposal.digests.proposal,
    baseDigest: baseBlueprint === null ? null : reviewDigest(baseBlueprint),
    candidateDigest: proposal.digests.artifact,
    graphDigest: reviewDigest(graph),
    reportDigest: reviewDigest(conformance),
    teethDigest: reviewDigest(proof),
    engineDigest: reviewDigest(engine),
    extractorDigest: reviewDigest(extractor),
    toolchainDigest: reviewDigest(toolchain),
    repositoryPolicyDiffDigest: reviewDigest(repositoryPolicyDiff),
  };
  const body = {
    schemaVersion: '1' as const,
    kind: 'BlueprintReviewPacket' as const,
    proposalId: proposal.proposalId,
    identity: { repository: proposal.context.repository, engine, extractor, toolchain },
    artifacts: { proposal, baseBlueprint, graph, repositoryPolicyDiff },
    contract,
    semanticDiff,
    conformance,
    proof,
    unsupportedCoverage: contract.unsupportedCoverage,
    provenance,
    approval: {
      status: blockers.length === 0 ? ('eligible' as const) : ('blocked' as const),
      requirements: detached(proposal.candidate.approvals),
      blockers,
    },
  };
  return BlueprintReviewPacketSchema.parse({ ...body, packetDigest: reviewDigest(body) });
}

function decisionBody(record: BlueprintDecisionRecord): Omit<BlueprintDecisionRecord, 'decisionDigest'> {
  const { decisionDigest, ...body } = record;
  void decisionDigest;
  return body;
}

/** Verify every content binding and replay every deterministic derivative in a packet. */
export function verifyReviewPacket(
  packetInput: BlueprintReviewPacket,
  decisionInput?: BlueprintDecisionRecord,
): ReviewPacketVerification {
  const failures: string[] = [];
  let packet: BlueprintReviewPacket;
  try {
    packet = BlueprintReviewPacketSchema.parse(detached(packetInput));
  } catch (error) {
    return { valid: false, integrity: 'failed', failures: [`packet schema invalid: ${(error as Error).message}`] };
  }
  if (reviewDigest(reviewPacketBody(packet)) !== packet.packetDigest) failures.push('packet digest mismatch');
  failures.push(...verifyProposal(packet.artifacts.proposal));
  if (packet.proposalId !== packet.artifacts.proposal.proposalId) failures.push('packet proposal id mismatch');
  if (!same(packet.identity.repository, packet.artifacts.proposal.context.repository)) failures.push('packet repository identity mismatch');
  if (packet.artifacts.graph.ctRepoRevision !== packet.identity.repository.revision) failures.push('packet graph revision is stale');
  if (packet.artifacts.graph.coverage.extractor !== packet.identity.extractor.kind) failures.push('packet extractor kind mismatch');
  if ((packet.artifacts.proposal.candidate.extraction?.profile ?? 'next-route-handler') !== packet.identity.extractor.profile) failures.push('packet extractor profile mismatch');
  const expectedDigests = {
    contextDigest: packet.artifacts.proposal.digests.context,
    planDigest: packet.artifacts.proposal.digests.plan,
    promptDigest: packet.artifacts.proposal.digests.prompt,
    generationDigest: packet.artifacts.proposal.digests.generation,
    proposalDigest: packet.artifacts.proposal.digests.proposal,
    baseDigest: packet.artifacts.baseBlueprint === null ? null : reviewDigest(packet.artifacts.baseBlueprint),
    candidateDigest: reviewDigest(packet.artifacts.proposal.candidate),
    graphDigest: reviewDigest(packet.artifacts.graph),
    reportDigest: reviewDigest(packet.conformance),
    teethDigest: reviewDigest(packet.proof),
    engineDigest: reviewDigest(packet.identity.engine),
    extractorDigest: reviewDigest(packet.identity.extractor),
    toolchainDigest: reviewDigest(packet.identity.toolchain),
    repositoryPolicyDiffDigest: reviewDigest(packet.artifacts.repositoryPolicyDiff),
  };
  for (const key of Object.keys(expectedDigests) as Array<keyof typeof expectedDigests>) {
    if (packet.provenance[key] !== expectedDigests[key]) failures.push(`packet provenance ${key} mismatch`);
  }
  try {
    const rebuilt = buildReviewPacket({
      proposal: packet.artifacts.proposal,
      baseBlueprint: packet.artifacts.baseBlueprint,
      graph: packet.artifacts.graph as unknown as ArchitectureGraph,
      engine: packet.identity.engine,
      extractor: packet.identity.extractor,
      toolchain: packet.identity.toolchain,
      repositoryPolicyDiff: packet.artifacts.repositoryPolicyDiff,
      resolvedScope: {
        matchedFiles: packet.contract.resolvedScope.matchedFiles,
        excludedPaths: packet.contract.resolvedScope.excludedPaths,
        excludedClasses: packet.contract.resolvedScope.excludedClasses,
      },
    });
    if (!same(rebuilt, packet)) failures.push('packet does not reproduce from its bound inputs');
  } catch (error) {
    failures.push(`packet replay failed: ${(error as Error).message}`);
  }

  let decisionValid: boolean | undefined;
  if (decisionInput !== undefined) {
    const packetWasValid = failures.length === 0;
    const decisionFailures: string[] = [];
    try {
      const decision = BlueprintDecisionRecordSchema.parse(detached(decisionInput));
      if (reviewDigest(decisionBody(decision)) !== decision.decisionDigest) decisionFailures.push('decision digest mismatch');
      if (decision.proposalId !== packet.proposalId) decisionFailures.push('decision proposal id mismatch');
      if (decision.binding.packetDigest !== packet.packetDigest) decisionFailures.push('decision packet binding is stale');
      if (decision.binding.candidateDigest !== packet.provenance.candidateDigest) decisionFailures.push('decision candidate binding is stale');
      if (decision.binding.repositoryRevision !== packet.identity.repository.revision) decisionFailures.push('decision repository revision is stale');
      if (decision.binding.worktreeDigest !== packet.identity.repository.worktreeDigest) decisionFailures.push('decision worktree binding is stale');
      if (decision.binding.engineArtifactDigest !== packet.identity.engine.artifactDigest) decisionFailures.push('decision engine binding is stale');
      if (decision.binding.extractorArtifactDigest !== packet.identity.extractor.artifactDigest) decisionFailures.push('decision extractor binding is stale');
      if (decision.binding.toolchainDigest !== packet.provenance.toolchainDigest) decisionFailures.push('decision toolchain binding is stale');
      if (decision.decision === 'approve' && packet.approval.status !== 'eligible') decisionFailures.push('approval decision targets a blocked packet');
      if (decision.decision === 'approve' && packet.approval.requirements.length > 1) {
        decisionFailures.push('one approval decision cannot satisfy multiple blueprint approval requirements');
      }
      if (
        decision.decision === 'approve' &&
        packet.approval.requirements.length === 1 &&
        !same(decision.satisfiedRequirement, packet.approval.requirements[0])
      ) decisionFailures.push('decision does not satisfy the blueprint approval requirement');
      if (decision.decision !== 'approve' && decision.satisfiedRequirement !== null) {
        decisionFailures.push('non-approval decision cannot satisfy an approval requirement');
      }
      const weakeningAcceptanceRequired = decision.decision === 'approve' && packet.semanticDiff.classification === 'relaxation';
      if (decision.weakeningAccepted !== weakeningAcceptanceRequired) {
        decisionFailures.push('decision weakening acceptance does not match the reviewed semantic classification');
      }
    } catch (error) {
      decisionFailures.push(`decision schema invalid: ${(error as Error).message}`);
    }
    failures.push(...decisionFailures);
    decisionValid = packetWasValid && decisionFailures.length === 0;
  }
  return {
    valid: failures.length === 0,
    integrity: failures.length === 0 ? 'verified' : 'failed',
    ...(decisionValid !== undefined ? { decisionValid } : {}),
    failures,
  };
}

/**
 * Record a human decision bound to the exact packet bytes. The caller must authenticate the
 * reviewer; provider/network verification intentionally lives outside this deterministic core.
 */
export function recordReviewDecision(args: {
  packet: BlueprintReviewPacket;
  decision: BlueprintDecisionRecord['decision'];
  reviewer: AuthenticatedReviewer;
  rationale: string;
  decidedAt: string;
  satisfiedRequirement?: Approval | null;
  weakeningAccepted?: boolean;
}): BlueprintDecisionRecord {
  const packet = BlueprintReviewPacketSchema.parse(detached(args.packet));
  const packetVerification = verifyReviewPacket(packet);
  if (!packetVerification.valid) throw new Error(`cannot decide an invalid review packet: ${packetVerification.failures.join('; ')}`);
  if (args.decision === 'approve' && packet.approval.status !== 'eligible') {
    throw new Error(`cannot approve a blocked review packet: ${packet.approval.blockers.join('; ')}`);
  }
  const requirements = packet.approval.requirements;
  const satisfiedRequirement = args.satisfiedRequirement === undefined ? null : detached(args.satisfiedRequirement);
  if (args.decision === 'approve') {
    if (requirements.length > 1) {
      throw new Error('one decision cannot satisfy multiple blueprint approval requirements');
    }
    if (requirements.length === 1 && !same(requirements[0], satisfiedRequirement)) {
      throw new Error('approval decision does not satisfy the blueprint approval requirement');
    }
  }
  const weakeningAcceptanceRequired = args.decision === 'approve' && packet.semanticDiff.classification === 'relaxation';
  if ((args.weakeningAccepted ?? false) !== weakeningAcceptanceRequired) {
    throw new Error('deterministic policy weakening requires explicit authenticated acceptance');
  }
  const reviewer = AuthenticatedReviewerSchema.parse(detached(args.reviewer));
  const body = {
    schemaVersion: '1' as const,
    kind: 'BlueprintDecisionRecord' as const,
    proposalId: packet.proposalId,
    decision: args.decision,
    binding: {
      // The packet's canonical identifier is its non-recursive body digest. Packet verification
      // proves that the stored field and every other packet byte reproduce from that body.
      packetDigest: packet.packetDigest,
      candidateDigest: packet.provenance.candidateDigest,
      repositoryRevision: packet.identity.repository.revision,
      worktreeDigest: packet.identity.repository.worktreeDigest,
      engineArtifactDigest: packet.identity.engine.artifactDigest,
      extractorArtifactDigest: packet.identity.extractor.artifactDigest,
      toolchainDigest: packet.provenance.toolchainDigest,
    },
    reviewer,
    satisfiedRequirement: args.decision === 'approve' ? satisfiedRequirement : null,
    weakeningAccepted: weakeningAcceptanceRequired,
    rationale: args.rationale,
    decidedAt: args.decidedAt,
  };
  return BlueprintDecisionRecordSchema.parse({ ...body, decisionDigest: reviewDigest(body) });
}
