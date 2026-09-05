/**
 * Versioned contracts for the AI-first blueprint proposal and human-review flow.
 *
 * These schemas are deliberately data-only. Provider transport, repository reads,
 * authentication, rendering, and persistence belong to callers. The deterministic
 * core consumes already-bounded facts and produces content-addressed records.
 */
import { z } from 'zod';
import {
  ApprovalSchema,
  BlueprintArchitectureSchema,
  BlueprintExtractionSchema,
  BlueprintMetadataSchema,
  ConstraintSchema,
  EngineeringBlueprintSchema,
  refineModuleGraphBlueprint,
  EvidenceRequirementSchema,
  ExtractionProfileSchema,
} from './schema.js';

export const ReviewDigestSchema = z.string().regex(/^[0-9a-f]{64}$/, 'expected a lowercase sha256 digest');

const NonEmptyString = z.string().min(1);
export const ProposalIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,127}$/, 'proposal id must be lowercase kebab-case');
const RepoRelativePathSchema = NonEmptyString.superRefine((value, ctx) => {
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'path must be repository-relative' });
  }
  if (normalized.split('/').includes('..')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "path must not contain '..' traversal" });
  }
  if (normalized.includes('\0')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'path must not contain NUL' });
  }
});

export const ProposalRepositoryIdentitySchema = z
  .object({
    identity: NonEmptyString,
    revision: NonEmptyString,
    worktreeDigest: ReviewDigestSchema,
  })
  .strict();

export const ProposalFileSchema = z
  .object({
    path: RepoRelativePathSchema,
    content: z.string(),
    bytes: z.number().int().nonnegative(),
    sha256: ReviewDigestSchema,
    mediaType: NonEmptyString.optional(),
  })
  .strict();

export const AuthoritativeIntentReferenceSchema = z
  .object({
    ref: NonEmptyString,
    content: z.string(),
    sha256: ReviewDigestSchema,
  })
  .strict();

export const ProposalContextSchema = z
  .object({
    schemaVersion: z.literal('1'),
    kind: z.literal('ProposalContext'),
    repository: ProposalRepositoryIdentitySchema,
    files: z.array(ProposalFileSchema),
    humanIntent: NonEmptyString,
    authoritativeIntentRefs: z.array(AuthoritativeIntentReferenceSchema).min(1),
    excluded: z
      .object({
        paths: z.array(RepoRelativePathSchema),
        classes: z.array(NonEmptyString),
      })
      .strict(),
    contextDigest: ReviewDigestSchema,
  })
  .strict();
export type ProposalContext = z.infer<typeof ProposalContextSchema>;

export const DraftSourceAnchorSchema = z
  .object({
    kind: z.enum(['repository-file', 'intent-reference']),
    ref: NonEmptyString,
    sha256: ReviewDigestSchema,
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((anchor, ctx) => {
    if (anchor.lineStart === undefined && anchor.lineEnd !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lineEnd'], message: 'lineEnd requires lineStart' });
    }
    if (
      anchor.lineStart !== undefined &&
      anchor.lineEnd !== undefined &&
      anchor.lineEnd < anchor.lineStart
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lineEnd'], message: 'lineEnd must be >= lineStart' });
    }
  });

export const DraftAssertionSchema = z
  .object({
    claim: NonEmptyString,
    basis: z.enum(['observed-fact', 'source-backed-intent', 'assistant-proposal']),
    anchors: z.array(DraftSourceAnchorSchema).min(1),
    uncertainty: z
      .object({
        level: z.enum(['none', 'low', 'medium', 'high']),
        reason: NonEmptyString,
      })
      .strict(),
    alternatives: z.array(NonEmptyString),
    knownBlindSpots: z.array(NonEmptyString),
  })
  .strict();
export type DraftAssertion = z.infer<typeof DraftAssertionSchema>;

const DraftMetadataSchema = z
  .object({
    id: NonEmptyString,
    name: NonEmptyString.optional(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version must be semver x.y.z'),
    ownerRole: NonEmptyString.optional(),
    stewardRole: NonEmptyString.optional(),
  })
  .strict();

const ProposedScopeSchema = z
  .object({
    repositories: z.array(NonEmptyString).min(1),
    paths: z.array(RepoRelativePathSchema).optional(),
    environments: z.array(NonEmptyString).optional(),
    assertions: z.array(DraftAssertionSchema).min(1),
  })
  .strict();

export const BlueprintDraftClauseSchema = z
  .object({
    constraint: ConstraintSchema,
    assertions: z.array(DraftAssertionSchema).min(1),
  })
  .strict();

export const BlueprintDraftPlanSchema = z
  .object({
    schemaVersion: z.literal('1'),
    kind: z.literal('BlueprintDraftPlan'),
    proposalId: ProposalIdSchema,
    contextDigest: ReviewDigestSchema,
    metadata: DraftMetadataSchema,
    scope: ProposedScopeSchema,
    architecture: BlueprintArchitectureSchema,
    clauses: z.array(BlueprintDraftClauseSchema).min(1),
    evidenceRequirements: z.array(EvidenceRequirementSchema),
    approvals: z.array(ApprovalSchema),
    extraction: BlueprintExtractionSchema.optional(),
    minEngineVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
    knownBlindSpots: z.array(NonEmptyString),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const seen = new Set<string>();
    for (let index = 0; index < plan.clauses.length; index += 1) {
      const id = plan.clauses[index]!.constraint.id;
      if (seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clauses', index, 'constraint', 'id'],
          message: `duplicate constraint id '${id}'`,
        });
      }
      seen.add(id);
    }
  });
export type BlueprintDraftPlan = z.infer<typeof BlueprintDraftPlanSchema>;

export const BlueprintProposalSchema = z
  .object({
    schemaVersion: z.literal('1'),
    kind: z.literal('BlueprintProposal'),
    proposalId: ProposalIdSchema,
    context: ProposalContextSchema,
    plan: BlueprintDraftPlanSchema,
    candidate: EngineeringBlueprintSchema.extend({
      metadata: BlueprintMetadataSchema.extend({ status: z.literal('draft') }),
    }).superRefine(refineModuleGraphBlueprint),
    digests: z
      .object({
        context: ReviewDigestSchema,
        plan: ReviewDigestSchema,
        prompt: ReviewDigestSchema,
        generation: ReviewDigestSchema,
        artifact: ReviewDigestSchema,
        proposal: ReviewDigestSchema,
      })
      .strict(),
  })
  .strict();
export type BlueprintProposal = z.infer<typeof BlueprintProposalSchema>;

export const PolicyChangeClassificationSchema = z.enum([
  'tightening',
  'neutral',
  'relaxation',
  'unknown-potential-relaxation',
]);
export type PolicyChangeClassification = z.infer<typeof PolicyChangeClassificationSchema>;

export const PolicyComparisonSchema = z
  .object({
    schemaVersion: z.literal('1'),
    classification: PolicyChangeClassificationSchema,
    blocksApproval: z.boolean(),
    changes: z.array(
      z
        .object({
          path: NonEmptyString,
          classification: PolicyChangeClassificationSchema,
          summary: NonEmptyString,
          before: z.string().optional(),
          after: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type PolicyComparison = z.infer<typeof PolicyComparisonSchema>;

export const ConstraintReviewSchema = z
  .object({
    constraintId: NonEmptyString,
    type: NonEmptyString,
    severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
    canonicalJson: NonEmptyString,
    plainLanguage: NonEmptyString,
    promise: NonEmptyString,
    lens: z
      .object({
        summary: NonEmptyString,
        matchedScope: z.array(NonEmptyString),
      })
      .strict(),
    proof: z
      .object({
        gradeability: z.enum(['graded', 'unsupported', 'indeterminate']),
        teeth: z.enum(['TOOTHED', 'EVALUATOR_REFUTABLE', 'TRIVIALLY_GREEN', 'INDETERMINATE', 'not-assessed']),
        summary: NonEmptyString,
      })
      .strict(),
    limits: z.array(NonEmptyString),
  })
  .strict();
export type ConstraintReview = z.infer<typeof ConstraintReviewSchema>;

export const BlueprintInspectionSchema = z
  .object({
    schemaVersion: z.literal('1'),
    blueprintRef: NonEmptyString,
    intent: z.array(NonEmptyString).min(1),
    plainLanguageContract: NonEmptyString,
    resolvedScope: z
      .object({
        repositories: z.array(NonEmptyString).min(1),
        declaredPaths: z.array(RepoRelativePathSchema),
        matchedFiles: z.array(RepoRelativePathSchema),
        excludedPaths: z.array(RepoRelativePathSchema),
        excludedClasses: z.array(NonEmptyString),
      })
      .strict(),
    clauses: z.array(ConstraintReviewSchema).min(1),
    unsupportedCoverage: z.array(NonEmptyString),
  })
  .strict();
export type BlueprintInspection = z.infer<typeof BlueprintInspectionSchema>;

export const ReviewEngineIdentitySchema = z
  .object({
    name: z.literal('bce-engine'),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    artifactDigest: ReviewDigestSchema,
    sourceRevision: NonEmptyString,
  })
  .strict();
export type ReviewEngineIdentity = z.infer<typeof ReviewEngineIdentitySchema>;

export const ReviewExtractorIdentitySchema = z
  .object({
    provider: NonEmptyString,
    kind: z.enum(['ast', 'line-scan']),
    profile: ExtractionProfileSchema,
    version: NonEmptyString,
    artifactDigest: ReviewDigestSchema,
  })
  .strict();
export type ReviewExtractorIdentity = z.infer<typeof ReviewExtractorIdentitySchema>;

export const ReviewToolchainIdentitySchema = z
  .object({
    runtime: NonEmptyString,
    version: NonEmptyString,
    platform: NonEmptyString,
    arch: NonEmptyString,
    packageManager: z.object({ name: z.literal('npm'), version: NonEmptyString }).strict(),
    dependencyLockDigest: ReviewDigestSchema,
  })
  .strict();
export type ReviewToolchainIdentity = z.infer<typeof ReviewToolchainIdentitySchema>;

export const RepositoryPolicyDiffSchema = z
  .object({
    baseRef: NonEmptyString.nullable(),
    baseHeadRevision: NonEmptyString.nullable(),
    baseRevision: NonEmptyString.nullable(),
    complete: z.boolean(),
    files: z.array(
      z.object({
        path: RepoRelativePathSchema,
        before: z.string().optional(),
        after: z.string().optional(),
      }).strict(),
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    const bindings = [value.baseRef, value.baseHeadRevision, value.baseRevision];
    if (value.complete && bindings.some((binding) => binding === null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'a complete repository policy diff requires the base ref, base head revision, and merge-base revision' });
    }
    if (!value.complete && bindings.some((binding) => binding !== null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'an incomplete repository policy diff must not claim partial base bindings' });
    }
  });
export type RepositoryPolicyDiff = z.infer<typeof RepositoryPolicyDiffSchema>;

const ObservedComponentSchema = z
  .object({ id: NonEmptyString, type: NonEmptyString, path: RepoRelativePathSchema, line: z.number().int().positive() })
  .strict();
const ObservedEdgeSchema = z
  .object({ from: NonEmptyString, to: NonEmptyString, type: NonEmptyString, evidenceRef: NonEmptyString })
  .strict();
export const ReviewArchitectureGraphSchema = z
  .object({
    schemaVersion: z.literal('1'),
    ctRepoRevision: NonEmptyString,
    components: z.array(ObservedComponentSchema),
    guardEdges: z.array(ObservedEdgeSchema),
    coverage: z
      .object({
        extractor: z.enum(['ast', 'line-scan']),
        filesScanned: z.number().int().nonnegative(),
        unsupported: z.array(z.string()),
        scannedFiles: z.array(RepoRelativePathSchema).optional(),
        patternScan: z
          .object({
            patterns: z.array(z.string()),
            hits: z.array(
              z.object({ pattern: z.string(), file: RepoRelativePathSchema, line: z.number().int().positive() }).strict(),
            ),
          })
          .strict()
          .optional(),
        unresolvedEgress: z
          .array(z.object({ callee: NonEmptyString, ref: NonEmptyString }).strict())
          .optional(),
      })
      .strict(),
  })
  .strict();

const ComplianceViolationSchema = z
  .object({
    constraintId: NonEmptyString,
    severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
    component: NonEmptyString,
    evidenceType: NonEmptyString,
    evidenceRef: NonEmptyString,
    observed: NonEmptyString,
    expected: NonEmptyString,
  })
  .strict();
export const ReviewComplianceReportSchema = z
  .object({
    schemaVersion: z.literal('1'),
    blueprintRef: NonEmptyString,
    ctRepoRevision: NonEmptyString,
    score: z.number().min(0).max(100),
    verdict: z.enum(['pass', 'fail']),
    violations: z.array(ComplianceViolationSchema),
    evidenceRef: NonEmptyString,
    summary: NonEmptyString,
    coverage: z
      .object({
        extractor: z.enum(['ast', 'line-scan']),
        filesScanned: z.number().int().nonnegative(),
        unsupported: z.array(z.string()),
      })
      .strict(),
    repo: NonEmptyString.optional(),
    mode: z.enum(['enforced', 'advisory']).optional(),
  })
  .strict();

const RefutabilityWitnessSchema = z
  .object({
    constraintId: NonEmptyString,
    type: NonEmptyString,
    verdict: z.enum(['TOOTHED', 'EVALUATOR_REFUTABLE', 'TRIVIALLY_GREEN', 'INDETERMINATE']),
    mutation: NonEmptyString,
  })
  .strict();
export const ReviewTeethReportSchema = z
  .object({
    schemaVersion: z.literal('1'),
    blueprintRef: NonEmptyString,
    witnesses: z.array(RefutabilityWitnessSchema),
    toothed: z.number().int().nonnegative(),
    evaluatorRefutable: z.number().int().nonnegative(),
    triviallyGreen: z.number().int().nonnegative(),
    indeterminate: z.number().int().nonnegative(),
    verdict: z.enum(['toothed', 'toothless', 'evaluator-refutable']),
    summary: NonEmptyString,
    readiness: z
      .object({
        status: z.enum(['ready', 'waived', 'refusal']),
        proof: z.enum(['extractor-real', 'reviewed-evaluator-waiver', 'insufficient']),
        waiver: z
          .object({ reviewer: NonEmptyString, rationale: NonEmptyString, evidenceRef: NonEmptyString })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const BlueprintReviewPacketSchema = z
  .object({
    schemaVersion: z.literal('1'),
    kind: z.literal('BlueprintReviewPacket'),
    proposalId: ProposalIdSchema,
    identity: z
      .object({
        repository: ProposalRepositoryIdentitySchema,
        engine: ReviewEngineIdentitySchema,
        extractor: ReviewExtractorIdentitySchema,
        toolchain: ReviewToolchainIdentitySchema,
      })
      .strict(),
    artifacts: z
      .object({
        proposal: BlueprintProposalSchema,
        baseBlueprint: EngineeringBlueprintSchema.nullable(),
        graph: ReviewArchitectureGraphSchema,
        repositoryPolicyDiff: RepositoryPolicyDiffSchema,
      })
      .strict(),
    contract: BlueprintInspectionSchema,
    semanticDiff: PolicyComparisonSchema,
    conformance: ReviewComplianceReportSchema,
    proof: ReviewTeethReportSchema,
    unsupportedCoverage: z.array(NonEmptyString),
    provenance: z
      .object({
        contextDigest: ReviewDigestSchema,
        planDigest: ReviewDigestSchema,
        promptDigest: ReviewDigestSchema,
        generationDigest: ReviewDigestSchema,
        proposalDigest: ReviewDigestSchema,
        baseDigest: ReviewDigestSchema.nullable(),
        candidateDigest: ReviewDigestSchema,
        graphDigest: ReviewDigestSchema,
        reportDigest: ReviewDigestSchema,
        teethDigest: ReviewDigestSchema,
        engineDigest: ReviewDigestSchema,
        extractorDigest: ReviewDigestSchema,
        toolchainDigest: ReviewDigestSchema,
        repositoryPolicyDiffDigest: ReviewDigestSchema,
      })
      .strict(),
    approval: z
      .object({
        status: z.enum(['eligible', 'blocked']),
        requirements: z.array(ApprovalSchema),
        blockers: z.array(NonEmptyString),
      })
      .strict(),
    packetDigest: ReviewDigestSchema,
  })
  .strict();
export type BlueprintReviewPacket = z.infer<typeof BlueprintReviewPacketSchema>;

export const AuthenticatedReviewerSchema = z
  .object({
    id: NonEmptyString,
    authentication: z
      .object({
        method: z.enum(['scm', 'sso']),
        issuer: NonEmptyString,
        subject: NonEmptyString,
        assertionDigest: ReviewDigestSchema,
        reference: z.string().url().regex(/^https:\/\//, 'authentication reference must use HTTPS'),
      })
      .strict(),
  })
  .strict();
export type AuthenticatedReviewer = z.infer<typeof AuthenticatedReviewerSchema>;

export const BlueprintDecisionRecordSchema = z
  .object({
    schemaVersion: z.literal('1'),
    kind: z.literal('BlueprintDecisionRecord'),
    proposalId: ProposalIdSchema,
    decision: z.enum(['approve', 'reject', 'request-changes']),
    binding: z
      .object({
        packetDigest: ReviewDigestSchema,
        candidateDigest: ReviewDigestSchema,
        repositoryRevision: NonEmptyString,
        worktreeDigest: ReviewDigestSchema,
        engineArtifactDigest: ReviewDigestSchema,
        extractorArtifactDigest: ReviewDigestSchema,
        toolchainDigest: ReviewDigestSchema,
      })
      .strict(),
    reviewer: AuthenticatedReviewerSchema,
    satisfiedRequirement: ApprovalSchema.nullable(),
    weakeningAccepted: z.boolean(),
    rationale: NonEmptyString,
    decidedAt: z.string().datetime({ offset: true }),
    decisionDigest: ReviewDigestSchema,
  })
  .strict();
export type BlueprintDecisionRecord = z.infer<typeof BlueprintDecisionRecordSchema>;

export interface ReviewPacketVerification {
  valid: boolean;
  integrity: 'verified' | 'failed';
  decisionValid?: boolean;
  failures: string[];
}
