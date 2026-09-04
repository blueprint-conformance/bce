/**
 * bce-engine — the Blueprint Engineering walking skeleton.
 *
 * Public surface: the authored-blueprint schema, the observed-graph model + extractors
 * (the net-new architecture-graph builder), the conformance diff + deterministic report,
 * and the revision-pinning helpers. The `bce` CLI (dist/cli.js) composes these.
 *
 * This package deliberately imports no host-application packages — the host owns the
 * runtime approval-state contract; this package owns the static authored-artifact +
 * architecture-graph + diff. One vision, two axes.
 */
export {
  EngineeringBlueprintSchema,
  parseBlueprint,
  ConstraintTypeSchema,
  SeveritySchema,
  ComponentSchema,
  RelationshipSchema,
  ConstraintSchema,
  BlueprintMetadataSchema,
  BlueprintScopeSchema,
  BlueprintArchitectureSchema,
  ExtractionProfileSchema,
  BlueprintExtractionSchema,
  // The fleet-level PortfolioBlueprint kind (additive; widen-only).
  PortfolioBlueprintSchema,
  PortfolioGovernanceSchema,
  PortfolioMemberSchema,
  parsePortfolioBlueprint,
  parseAnyBlueprint,
} from './schema.js';
export type {
  EngineeringBlueprint,
  ConstraintType,
  Severity,
  Component,
  Relationship,
  Constraint,
  EvidenceRequirement,
  Approval,
  BlueprintMetadata,
  BlueprintScope,
  BlueprintArchitecture,
  ExtractionProfile,
  BlueprintExtraction,
  PortfolioBlueprint,
  PortfolioGovernance,
  PortfolioMember,
  AnyBlueprintParse,
} from './schema.js';

// Fail-closed safe-compile guard for user-supplied `forbiddenPattern` regexes (guards the two
// `new RegExp(userInput)` sinks — cli.ts + schema.ts superRefine; closes CodeQL js/regex-injection).
export { safeCompilePattern, hasCatastrophicBacktracking, UnsafePatternError, SAFE_PATTERN_MAX_LENGTH } from './safe-regex.js';
export type { UnsafePatternReason } from './safe-regex.js';

export type {
  ArchitectureGraph,
  ObservedComponent,
  ObservedEdge,
  CoverageReport,
  RepositoryFactsExtractor,
} from './graph.js';

export {
  AstExtractor,
  LineScanExtractor,
  resolveExtraction,
  resolveFiles,
  ONTOLOGY_ROUTE_GLOBS,
  MIN_EXPECTED_ROUTE_FILES,
  resolveEgressHostLiterals,
  isGovernedHost,
} from './extractors.js';
export type { ResolvedExtraction, EgressHostResolution } from './extractors.js';

// the profile-aware extractor front door (the legacy kind-only constructor stays in
// extractors.ts for the TypeScript profiles; the registry adds language dispatch, widen-only).
export { makeExtractor, EXTRACTOR_PROVIDERS } from './extractor-registry.js';
export type { ExtractorProvider } from './extractor-registry.js';
export { PythonImportExtractor, pythonModuleId, parsePythonImports } from './python-extractor.js';

export { evaluate, stableStringify, SEVERITY_WEIGHT } from './report.js';
export type { ComplianceReport, Violation } from './report.js';

export { assessTeeth, ConstraintTeeth } from './teeth.js';
export type { TeethReport, RefutabilityWitness } from './teeth.js';
export { assessExtractorTeethCorpus, TeethMutationManifestSchema } from './extractor-teeth.js';
export type { TeethMutationManifest, ExtractorTeethReport, ExtractorTeethCaseResult } from './extractor-teeth.js';
export { readTeethWaiver, TeethWaiverError, TEETH_WAIVER_RELPATH } from './teeth-waiver.js';
export type { TeethWaiver } from './teeth-waiver.js';

export { resolveRevision, materializeAtRevision } from './pin.js';

export { runGate, discoverBlueprints, blueprintTouchesChanges, resolveTreeRevision, computeGateReport, assembleGateReportDoc } from './gate.js';
export type { GateResult, GateReportDoc, ComputedGate } from './gate.js';
export { doctorRepository, checkEngineUpgrade } from './lifecycle.js';
export type { DoctorReport, DoctorCheck, DoctorCheckStatus, EngineUpgradeCheck } from './lifecycle.js';
export { readPolicyHistory, semverGreater, PolicyHistoryError, POLICY_HISTORY_RELPATH } from './policy-history.js';
export type { PolicyHistoryEntry, PolicyOperation } from './policy-history.js';
export { classifyPolicyChanges } from './policy-change.js';
export type { PolicyChangeClass, FileChange, ClassifiedChange, PolicyChangeReport } from './policy-change.js';
export { createEvidenceBundle, verifyEvidenceBundle } from './evidence-bundle.js';
export type { EvidenceBundle, EvidenceBundleVerification } from './evidence-bundle.js';
export { validateJudgments, benchmarkMetrics, metricsByClass } from './benchmark.js';
export type { BenchmarkOutcome, BenchmarkJudgment, BenchmarkMetrics, Interval } from './benchmark.js';

export {
  assessBaselineMaintenance,
  renderBaselineShrinkPatch,
  planBaselineWrite,
  readBaseline,
  writeBaseline,
  BaselineError,
  BASELINE_RELPATH,
} from './baseline.js';
export type { BaselineCheckResult, BaselineCheckState, BaselineWritePlan, BaselineFile, BaselineEntry } from './baseline.js';

// Mode doctrine (SPEC §9) — advisory vs enforced adoption posture. The gate reads the mode from a
// COMMITTED `.bce-mode.json` (never a flag); advisory prints the full verdict + banner and exits 0.
// Exported so the THIN MCP/Action shells honor the SAME posture the CLI does (zero logic to diverge).
export {
  resolveMode,
  exitCodeForGate,
  appendGraduationRecord,
  writeModeConfig,
  readGraduationRecord,
  ModeConfigError,
  ADVISORY_BANNER,
  MODE_CONFIG_BASENAME,
  GRADUATION_RECORD_RELPATH,
} from './mode.js';
export type { GateMode, ResolvedMode, GraduationEntry } from './mode.js';

// The pure deterministic portfolio → per-repo overlay compiler.
export { compilePortfolio, serializeBlueprintCanonical, slugifyRepo } from './portfolio-compile.js';
export type { CompiledOverlay } from './portfolio-compile.js';

// The fail-closed portfolio collector (feeds architectureScore UNCHANGED).
export { collectPortfolio, PortfolioRegistrySchema } from './portfolio-collect.js';
export type { PortfolioRegistry, CollectedEnvelope, CollectResult, CollectRefusal, BoardInput } from './portfolio-collect.js';

export {
  toEvidenceRecord,
  verifyEvidenceChain,
  toWorkOrders,
  emitRun,
  canTransition,
  APPROVAL_FLOOR,
  EVIDENCE_GENESIS_HASH,
} from './emit.js';
export type { EvidenceRecord, RemediationWorkOrder, RunEmission, ApprovalState } from './emit.js';
export { resolveToolchainIdentity } from './runtime-identity.js';
export type { ToolchainIdentity } from './runtime-identity.js';

export {
  subsystemScore,
  architectureScore,
  toScoreSample,
  trendSummary,
  topViolations,
} from './score.js';
export type { SubsystemScore, ArchitectureScore, ScoreSample, TrendSummary, ViolationCount } from './score.js';

export { joinPlanes, evidenceItemsCount, compliancePack, UNATTRIBUTED_TRACE } from './evidence-store.js';
export type { AuditLogLine, EvidenceItem, EvidenceItemsCount, CompliancePack } from './evidence-store.js';
export { SEEDED_CORPUS, caughtDefect } from './corpus.js';
export type { SeededDefect } from './corpus.js';
export { measureRecall, gateVerdict, DEFAULT_THRESHOLDS } from './recall-gate.js';
export type { SeededRun, RecallMeasurement, GateThresholds, GateVerdict } from './recall-gate.js';
export { rollupViolations } from './violation-rollup.js';

// The materializer + intended-vs-observed diff (pure module; apply is ATTENDED).
export { materialize, materializeIntendedGraph, diffIntendedVsObserved, APPLY_IS_ATTENDED } from './materializer.js';
export type {
  IntendedGraph,
  MaterializationResult,
  DiffViolation,
  ViolationClass,
  UpsertDescriptor,
} from './materializer.js';

// AI-first proposal/review contracts and deterministic core. Provider transport and
// repository I/O remain explicit shells; no renderer owns policy logic.
export {
  ProposalContextSchema,
  BlueprintDraftPlanSchema,
  BlueprintProposalSchema,
  BlueprintReviewPacketSchema,
  BlueprintDecisionRecordSchema,
  PolicyChangeClassificationSchema,
  PolicyComparisonSchema,
  ConstraintReviewSchema,
  BlueprintInspectionSchema,
  ReviewEngineIdentitySchema,
  ReviewExtractorIdentitySchema,
  ReviewToolchainIdentitySchema,
  RepositoryPolicyDiffSchema,
} from './review-contracts.js';
export type {
  ProposalContext,
  BlueprintDraftPlan,
  BlueprintProposal,
  BlueprintReviewPacket,
  BlueprintDecisionRecord,
  PolicyChangeClassification,
  PolicyComparison,
  ConstraintReview,
  BlueprintInspection,
  ReviewEngineIdentity,
  ReviewExtractorIdentity,
  ReviewToolchainIdentity,
  RepositoryPolicyDiff,
  ReviewPacketVerification,
} from './review-contracts.js';
export {
  buildProposalContext,
  compileDraftPlan,
  inspectBlueprint,
  explainConstraint,
  compareBlueprintPolicy,
  buildReviewPacket,
  verifyReviewPacket,
  recordReviewDecision,
  reviewDigest,
} from './review.js';
export { renderReviewPacketText, renderReviewPacketHtml, reviewSafeText } from './review-render.js';
export {
  AssistantGenerationRecordSchema,
  OPENAI_RESPONSES_ENDPOINT,
  BLUEPRINT_PLAN_PROMPT,
  blueprintPlanPromptDigest,
  buildDisclosureManifest,
  createOpenAIResponsesAdapter,
  createRegisteredAssistant,
  verifyDisclosureManifest,
} from './assistant-adapter.js';
export type {
  AssistantGenerationRecord,
  AssistantGenerationResult,
  BlueprintAssistantAdapter,
  DisclosureManifest,
  OpenAIResponsesAdapterOptions,
} from './assistant-adapter.js';
