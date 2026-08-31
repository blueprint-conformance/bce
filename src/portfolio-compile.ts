/**
 * The portfolio → per-repo overlay COMPILER.
 *
 * `compilePortfolio()` lowers ONE authored PortfolioBlueprint into N per-member
 * EngineeringBlueprint overlays — one strict-valid blueprint per fleet member, each of which the
 * member repo's EXISTING `bce gate` consumes UNCHANGED. The compiler is the only new machinery;
 * the per-repo gate path is byte-untouched (widen-only: a 0.2.x consumer never sees this module).
 *
 * PURE + DETERMINISTIC: no fs, no wall-clock, no randomness. Same portfolio in → byte-identical
 * overlay set out (proven by the golden-fixture test). Canonical bytes come from
 * `serializeBlueprintCanonical` — the SAME recursively-key-sorted, 2-space-indented,
 * trailing-newline serializer the whole engine hashes on (`stableStringify`), re-exported under a
 * compile-facing name so the emitted overlay files are stable across compilers and platforms.
 *
 * repoDir-AWARENESS (the F-L2-5 hazard — read before "fixing" this):
 * a member's gate runs `bce gate --repo <checkout>/<repoDir>` — i.e. the scan root IS the
 * member's repoDir. The portfolio's shared extraction globs are authored relative to that scan
 * root, so for a subdir member (`repoDir: 'agent-host'`) the overlay paths stay AS-IS: they are
 * ALREADY repoDir-relative when evaluated where the gate actually runs. The hazard is a compiler
 * that "helpfully" PREFIXES paths with the repoDir (`agent-host/src/...`) — that would double the
 * prefix at gate time and resolve ZERO files (tripping the fail-closed minFiles floor at best,
 * silently ungating at worst). DO NOT PREFIX. The subdir golden-fixture test proves the emitted
 * overlay validates AND its paths match real files when evaluated at the repoDir.
 */
import {
  EngineeringBlueprintSchema,
  type EngineeringBlueprint,
  type PortfolioBlueprint,
  type PortfolioMember,
} from './schema.js';
import { stableStringify } from './report.js';

/** One compiled member overlay: the member row + its strict-valid per-repo blueprint. */
export interface CompiledOverlay {
  member: PortfolioMember;
  blueprint: EngineeringBlueprint;
}

/**
 * Slug a repo identity for use in overlay ids / sink dir names: lowercase, every run of
 * non-[a-z0-9] collapsed to '-', trimmed. `example-org/service-alpha` → `example-org-service-alpha`.
 * Deterministic and filesystem-safe.
 */
export function slugifyRepo(repo: string): string {
  return repo
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Canonical byte serialization for an emitted overlay (recursively sorted object keys,
 * 2-space indent, trailing newline). This IS `stableStringify` — one serializer for the whole
 * engine (consume-don't-duplicate), exposed under the compile-facing name so callers
 * writing overlay files don't reach into report.ts semantics.
 */
export function serializeBlueprintCanonical(bp: EngineeringBlueprint): string {
  return stableStringify(bp);
}

/**
 * Compile the portfolio into per-member EngineeringBlueprint overlays.
 *
 * Field mapping (every value traces to the portfolio — nothing invented):
 *  - `metadata.id`      = `${portfolio.metadata.id}--${slugifyRepo(member.repo)}`
 *  - `metadata.version` = `portfolio.governance.version` (the fleet governance version)
 *  - `metadata.status`  = the portfolio's status (an overlay is exactly as ratified as its fleet source)
 *  - `intentRefs`       = the portfolio's, verbatim
 *  - `scope.repositories` = `[member.repo]`; `scope.paths` = the shared extraction paths AS-IS
 *  - `extraction`       = the portfolio's shared extraction block AS-IS (see repoDir note above)
 *  - `constraints`      = `fleetConstraints` verbatim
 *  - `evidenceRequirements` / `approvals` / `architecture` = sane strict-valid defaults (the
 *    portfolio schema does not carry them; the defaults mirror the house fixture shape —
 *    staticAst/required/block + a blueprint-steward ratify stage + an empty intended graph).
 *
 * Every emitted overlay is re-validated through the STRICT EngineeringBlueprintSchema before
 * return — a compiler bug can never emit an artifact the gate would refuse to parse (fail closed
 * at compile time, not at the member's PR).
 */
export function compilePortfolio(portfolio: PortfolioBlueprint): CompiledOverlay[] {
  return portfolio.members.map((member) => {
    const overlay: EngineeringBlueprint = EngineeringBlueprintSchema.parse({
      apiVersion: portfolio.apiVersion,
      kind: 'EngineeringBlueprint',
      metadata: {
        id: `${portfolio.metadata.id}--${slugifyRepo(member.repo)}`,
        name: `${portfolio.metadata.name ?? portfolio.metadata.id} — ${member.repo} member overlay`,
        version: portfolio.governance.version,
        status: portfolio.metadata.status,
        ...(portfolio.metadata.ownerRole !== undefined ? { ownerRole: portfolio.metadata.ownerRole } : {}),
        ...(portfolio.metadata.stewardRole !== undefined ? { stewardRole: portfolio.metadata.stewardRole } : {}),
      },
      intentRefs: [...portfolio.intentRefs],
      scope: {
        repositories: [member.repo],
        // repoDir-aware = NOT prefixed (see the F-L2-5 note in the module header): the member's
        // gate runs with --repo at <checkout>/<repoDir>, so repo-root-anchored globs are ALREADY
        // repoDir-relative at the point of evaluation. '.' and subdir members get identical paths.
        ...(portfolio.extraction.paths !== undefined ? { paths: [...portfolio.extraction.paths] } : {}),
      },
      architecture: { components: [], relationships: [] },
      constraints: portfolio.fleetConstraints.map((c) => ({ ...c })),
      evidenceRequirements: [{ type: 'staticAst', required: true, onMissing: 'block' }],
      approvals: [{ role: 'blueprint-steward', stage: 'ratify' }],
      extraction: { ...portfolio.extraction },
    });
    return { member, blueprint: overlay };
  });
}
