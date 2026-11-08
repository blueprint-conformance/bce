# TypeScript module graph — enforce direct architecture boundaries

Use `typescript-module-graph` when the rule is about ordinary TypeScript or JavaScript modules,
not a framework-specific route or plugin shape. Every scanned module becomes a
`typescriptModule` component. Every statically named dependency becomes an `imports` edge before
any policy is applied.

This profile is available in the `v0.6.2` registry release. Install the exact version and run its packaged
proof:

```bash
npm view bce-engine@0.6.2 version dist.integrity
npm install --save-dev --save-exact bce-engine@0.6.2
npx --no-install bce demo --recipe module-layering
```

The clean tree imports from application code into domain code and scores 100. The drift tree adds
one reverse domain-to-application import; C3 names that edge and its source line.

## Fastest agent path: use the existing MCP done-check

This profile does not need a module-specific MCP server or another agent integration. Point the
existing `bce-mcp` stdio server at the target repository, then let the installed BCE skill use its
normal read-only loop:

```text
doctor_repository {}
run_gate {}
```

`run_gate {}` reads the live working tree, including uncommitted fixes. Its structured report names
the same constraint, importer, target, and source line as the CLI; after the source correction, the
same zero-argument call must return `gateFailed: false` and `outcome: "pass"`. MCP cannot author,
approve, weaken, or land policy.

Launch the installed `bce-mcp` binary with the target repository as its working directory. Normal
`bce onboard` installs the same Agent Skill, project-local MCP wiring, advisory mode, and immutable
CI in one operation. See [agent-loop.md](agent-loop.md) for client wiring and
[onboarding.md](onboarding.md) for the generated setup path.

## Directional layering

The portable first rule keeps `packages/domain/**` below `packages/app/**`. This is the core fragment
from the [complete executable fixture](../fixtures/typescript-module-layering.blueprint.json):

```json
{
  "minEngineVersion": "0.3.0",
  "constraints": [
    {
      "id": "domain-cannot-import-app",
      "type": "forbiddenDependency",
      "severity": "critical",
      "to": "module:packages/app/**",
      "scopePaths": ["packages/domain/**"]
    }
  ],
  "extraction": {
    "profile": "typescript-module-graph",
    "paths": ["packages/**/*.ts"],
    "minFiles": 2
  }
}
```

`scopePaths` always selects importer modules. `to` selects the dependency target. The profile
requires both fields on C2 and C3 so a stale or accidentally global boundary cannot look green.
It also requires `minEngineVersion >=0.3.0`; an older gate can then say “upgrade” before it tries to
parse newer vocabulary.

Run the measured [author → RED → fix → GREEN module-layering walkthrough](../examples/first-win/module-layering/README.md)
to create this boundary against a real two-layer tree. The example deliberately includes an
unrelated application module that does not import domain: a directional boundary should not force
every file in a higher layer to depend on the lower one.

## Required edges are narrower

C2 means **every importer in its scope** must carry the named direct edge. Use it only when that is
the actual invariant—for example, one adapter entry point that must delegate to domain:

```json
{
  "id": "checkout-entry-uses-domain",
  "type": "requiredDependency",
  "severity": "high",
  "component": "typescriptModule",
  "to": "module:packages/domain/**",
  "scopePaths": ["packages/app/checkout.ts"]
}
```

## Target selectors

| Selector | Matches | Example |
|---|---|---|
| `module:<repo-path-or-glob>` | a resolved file inside the repository | `module:src/server/**` |
| `package:<npm-root>` | one normalized package root, including all subpath imports | `package:@aws-sdk/client-s3` |
| `builtin:<node-name>` | one Node built-in, with `node:` normalized away | `builtin:fs/promises` |

These selectors support three high-return boundaries:

- Layer direction: domain or shared code cannot import app, UI, or infrastructure modules.
- Runtime separation: browser-facing modules cannot import server-only modules or Node built-ins.
- Choke points: feature modules cannot import database, transport, or provider SDK packages
  directly.

## Resolution

Without `extraction.tsconfig`, relative imports resolve lexically with a fixed extension and
`index.*` order. JavaScript specifiers such as `./order.js` resolve to authored TypeScript files
such as `order.ts`. A bare dependency becomes `package:<root>` only when an enclosing
`package.json` declares that root; otherwise BCE records the specifier as unresolved because it may
be a project alias. `node:` imports (including mandatory-prefix modules) and the public Node 22
unprefixed built-ins normalize to `builtin:` targets from a source-pinned vocabulary, so Node 22
and Node 24 produce the same graph.

Set `extraction.tsconfig` to one repository-relative config file when the repository uses
`baseUrl`, `paths`, or extended TypeScript configuration:

```json
{
  "extraction": {
    "profile": "typescript-module-graph",
    "paths": ["src/**/*.ts", "src/**/*.tsx"],
    "minFiles": 12,
    "tsconfig": "tsconfig.json"
  }
}
```

The BCE glob syntax does not support brace expansion, so each extension is a separate entry.
Extended configs must be repository-owned relative files. BCE refuses configs outside the
repository or under `node_modules` so module resolution cannot change independently of the gated
revision.

## What is observed

The AST provider records static imports, type-only imports, re-exports, JavaScript JSDoc `@import`,
TypeScript `import = require()` and `import("...")` types, unshadowed literal `require()` and
`require.resolve()`, and literal dynamic imports. Relative targets may resolve to repository modules outside the scanned component set;
that preserves the observed edge while `scopePaths` controls which importers are governed.

Computed imports, undeclared bare specifiers, and unresolved aliases are located under
`coverage.unresolvedImports`. A C2 or C3
boundary whose importer scope includes one of those facts fails closed: an unknown target is not
evidence that the required edge exists or the forbidden edge does not. Invalid source syntax,
invalid or escaping tsconfig resolution, imports escaping the repository, and line-scan requests
are refusals.

## Honest limits

This is a direct-import graph. It does not claim transitive reachability, cycle detection,
runtime-only loading, bundler plugin resolution, ownership inference, package-tag inference, or
automatic workspace expansion. Glob the files you intend to scan, set a real `minFiles` floor,
and use a tsconfig when aliases matter.

Next: [choose another executable boundary](first-win.md), [read C1–C4](constraint-guide.md), or
[install the gate in advisory mode](adopt-existing-repo.md).

## Review architecture changes between commits

`bce architecture-review` compares observed architecture at two full immutable Git commit SHAs
under one supplied blueprint and the same engine, dependency lock, runtime, and TypeScript AST
provider. It reads archived commits, so dirty working-tree changes do not contaminate either scan.
The supplied blueprint is frozen once for both revisions; it need not be the blueprint committed at
either revision. Policy amendment review remains a separate workflow.

```sh
node dist/cli.js architecture-review --repo . --blueprint boundary.blueprint.json \
  --base <40-character-base-commit-sha> --head <40-character-head-commit-sha> \
  --out architecture-review.json
```

Without `--out`, JSON goes to stdout. An output path must not exist; the command never overwrites a
source, policy, baseline, or earlier report. Exit 0 means the head conforms, 1 means it has raw
violations (including retained debt), and 2 means the comparison was refused or acquisition failed.
Comparison refusals carry `status: "refused"`, reasons, and `delta: null`; acquisition errors print a
reason to stderr and produce no report. This review does not replace `bce gate`, apply a baseline,
change policy, or authorize a merge.

The report includes added, removed, and retained modules, direct dependencies, and raw violations,
plus both revisions, input digests, the frozen blueprint digest, toolchain identity, provider coverage,
and a report digest. For violations, added means newly observed, removed means resolved under this
contract, and retained means still present. Evidence retains the base and head source anchors.
Module identity is its path/type; dependency identity is source, target, and kind. Line-only changes
do not invent additions or fixes. Renames are removal plus addition, with no claim of symbol identity.
Repeated indistinguishable edges or violations refuse the whole comparison rather than matching
individual occurrences by source line.

This first slice supports `typescript-module-graph` and `forbiddenDependency`, `requiredDependency`,
`requiredComponent`, `forbiddenPath`, and `forbiddenFile` constraints. Other constraints, unresolved
imports, changed provider limitations, missing coverage, symlinks, submodules, and a tracked module
vanishing from extraction refuse comparison. A genuinely deleted module is reported as removed.
Resolver inputs are conservatively frozen: all tracked JSON files must remain byte-identical,
including unrelated JSON; all files actually read in the tsconfig extends chain are frozen as well,
even without a JSON suffix. This restriction avoids attributing resolution-setting changes to code.
The static provider's direct-import limits still apply; there are no runtime, cycle, or transitive
claims.

The public API is `reviewArchitectureChange({ repoDir, baseRevision, headRevision, blueprint })`.
`compareArchitectureSnapshots(base, head)` provides deterministic replay for callers that already
have graphs, tracked-file manifests, the complete blueprint, resolver-input digests, and toolchain
identities. Caller-supplied snapshots are assertions: their digests prove integrity, not authenticity.
`architectureReviewExitCode(report)` implements the same 0/1/2 result as the CLI.

## Bounded paths (RFC-0004)

The `v0.6.1` release implements accepted [RFC-0004](../rfcs/RFC-0004-bounded-dependency-path.md):
an explicit `forbiddenDependencyPath` arm with `maxHops: 2`. Existing
`forbiddenDependency` remains direct. v0.6.0 and earlier do not recognize the arm and fail the
`minEngineVersion` preflight instead of skipping it.

```json
{
  "id": "domain-cannot-reach-app",
  "type": "forbiddenDependencyPath",
  "severity": "critical",
  "scopePaths": ["src/domain/**"],
  "to": "module:src/app/**",
  "maxHops": 2
}
```

Use `minEngineVersion: "0.6.1"` and scan a superset such as
`extraction.paths: ["src/**/*.ts"]`: the intermediate module must be scanned even when
it is outside the governed source scope. The ordinary CLI/API/MCP gate then reports a
complete anchored one/two-edge witness. An unresolved or unscanned intermediate, a
missing coverage inventory, or zero matching source roots refuses with exit 2. Paths
of three or more edges and external package internals are outside the explicit bound.

## Preview a policy change on frozen source

`bce policy-impact` evaluates two supplied policies against **one extraction of one immutable
Git commit**. It returns both raw reports, the existing semantic policy classification, and
introduced, removed and retained findings. A removed finding means the policy stopped reporting it;
it does not mean the source was repaired. Neither this result nor its exit code approves a policy.

```sh
bce policy-impact --repo . --repo-name example-org/storefront \
  --revision <full-commit-sha> \
  --base-blueprint base.blueprint.json --candidate-blueprint candidate.blueprint.json \
  --out policy-impact.json
```

The installed API is `reviewPolicyImpact({ repoDir, repoName, revision, baseBlueprint,
candidateBlueprint })`. Its `PolicyImpactReview` result records both policy digests, complete
resolved acquisition settings, a policy-independent source-acquisition digest (graph, toolchain,
tracked inventory and resolver inputs), exact coverage,
toolchain identity and an artifact digest. Digests prove integrity, not origin authenticity; the
supplied repository name must be applicable to both policies but is not authenticated by this call.
Uncommitted source changes, Git replacement objects, mutable Git attributes and caller Git configuration do not alter the pinned acquisition. Committed `.gitattributes` remain part of the immutable input.
Policy inputs are supplied documents, not implicitly loaded from the commit.

This first slice admits direct TypeScript module dependency constraints, required module components,
and forbidden paths/files, with explicitly supported constraint fields. It requires identical
complete policy scope and resolved extraction settings, including constraint-derived settings.
Changing a dependency target can therefore be refused even when the provider would not use the
changed setting. The only admitted evidence requirement is exactly one
`{ "type": "staticAst", "required": true, "onMissing": "block" }` entry. Other evidence classes,
freshness or coverage qualifiers, unknown fields, duplicate constraint identities and unsupported
constraint shapes are refused. Each policy's engine minimum must be satisfied.

Missing or inconsistent scanned coverage, unresolved imports, invalid source, submodules, tracked
symlinks and ambiguous repeated finding identities also refuse comparison. Refusals contain reasons and
`delta: null`; they never mean unchanged. Constraint-ID renames and severity changes remain visible
as removal plus introduction. Raw results exclude baseline filtering and advisory-mode overrides:
exit **0** means comparable with candidate pass, **1** comparable with candidate fail, and **2**
refused or unavailable. Output creation is exclusive: an existing artifact or input cannot be
overwritten. Continue using `bce gate` and the policy review process for their separate decisions.

For a small reproducible example, use the layering fixture with a committed import from
`packages/domain/model.ts` to `packages/app/api.ts`. Keep both policies' extraction settings fixed.
Set the base constraint `domain-cannot-import-app` to `scopePaths: ["packages/app/**"]` and retain
`scopePaths: ["packages/domain/**"]` in the candidate. The unchanged source produces one introduced
finding under the candidate; reversing the policies removes that finding without repairing code.
This exercises a policy selector change, not a complete application or runtime guarantee.

The repository test `tests/policy-impact.test.ts` also runs a diagnostic projection of the actual
`only-extractors-may-import-ts-morph` rule against the current immutable BCE commit. Broadening its
source selector to include the permitted extractor introduces the anchored `ts-morph` import finding;
this does not claim that the full plugin-profile self-blueprint is supported by policy impact.
