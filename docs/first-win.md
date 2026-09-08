# First win — choose the boundary that must hold

Do not begin by learning the whole specification. Run the architecture failure closest to the one
you need to prevent. Each recipe stays offline and runs one conforming tree plus one planted drift
tree through the same engine used by the merge gate.

**Release boundary:** the immutable `bce-engine@0.3.0` registry release contains both the original
zero-argument demo and the six named recipes below. Use the exact version; do not substitute a range
or `latest` for a merge gate.

Run the released proof:

```bash
npm view bce-engine@0.3.0 version dist.integrity
npm install --save-dev --save-exact bce-engine@0.3.0
npx --no-install bce demo
```

Run the released catalog:

```bash
npx --no-install bce demo --list
npx --no-install bce demo --recipe tenant-route-guard
```

The last command exits `0` only after proving both sides: the conforming tree scores 100, and the
drifted tree produces the named `d6-tenant-guard` violation. Run every recipe with
`npx --no-install bce demo --recipe all`.

The package includes `examples/` plus the recipe fixtures. Its clean-room package proof packs and
installs the tarball outside the source checkout, then runs the zero-argument contract and all six
recipes. The release record independently binds that tarball to the npm artifact.

<p align="center">
  <picture>
    <source media="(max-width: 600px)" srcset="../assets/diagrams/first-win-recipes-mobile.svg">
    <img src="../assets/diagrams/first-win-recipes.svg" alt="Six executable BCE recipe paths branch from the architecture boundary a maintainer needs to protect. Extension contracts, Next.js tenant route guards, and governed egress use TypeScript or JavaScript AST extraction. TypeScript and Python layering use direct structured module graphs. Configuration allowlists use a real-source content-pattern pair. Every path runs a conforming tree to GREEN and planted drift to a named RED violation.">
  </picture>
</p>

## Pick by architectural intent

| What must not drift? | Recipe id | Evidence and maturity |
|---|---|---|
| A plugin or agent extension must exist, register through the governed helper, and avoid direct provider SDKs | `extension-contract` | TypeScript/JavaScript, mature AST; C1–C3 in one contract |
| Recognized route handlers must contain a call to a configured, governed guard | `tenant-route-guard` | Next.js TypeScript; syntactic call-site evidence only; see limits below |
| Raw network calls must stay on governed hosts | `governed-egress` | TypeScript/JavaScript, mature AST; resolved literal host evidence |
| Domain, UI, server, or infrastructure layers must keep their direction | `module-layering` | TypeScript/JavaScript direct module graph; resolved importer, target, and source line |
| Python service layers must keep their direction | `python-module-layering` | Python structured direct module graph; explicit roots, resolved repository targets, and fail-closed uncertainty |
| A governed manifest must not silently widen | `configuration-allowlist` | JSON/Markdown real-source RED/GREEN pair; content-pattern teeth are evaluator-refutable |

Run one with `npx --no-install bce demo --recipe <id>`. The catalog is
executable: CI runs every listed recipe and refuses missing fixtures, a false GREEN, a false RED,
or the wrong violation id.

## Route guard evidence boundary

A route `guards` edge means a matching bare-identifier call was found among the handler's
syntax descendants and resolves to an import from a blueprint-declared governed module.
It does **not** prove that authorization executes, completes before a response, propagates a
denial, or checks the tenant/resource being returned. The guard implementation is not verified.
A conditional, unreachable, nested-but-uncalled, unawaited, or caught-and-ignored call can satisfy
this syntactic check. Checking the wrong tenant can also satisfy it.

**Released v0.3.0 limitation:** only exported function declarations named GET, POST, PATCH, PUT,
or DELETE are recognized. Arrow handlers and function expressions can be omitted. An all-arrow
surface fails the zero-handler check, but omitted handlers alongside recognized guarded handlers
can produce a misleading pass. File counts are not handler coverage. Do not use this release's
route check as proof that every route enforces access control.

**Source correction (unreleased):** direct named function declarations and immutable `const`
arrow/function-expression exports are inventoried for GET, POST, PATCH, PUT, DELETE, HEAD, and
OPTIONS. Relevant indirect exports, wrappers, mutable handlers, and star re-exports refuse
extraction with a source location. Use a direct supported export or keep the result unverified;
do not remove a route from the configured scan to obtain a pass. Default exports are not named
HTTP handlers. Inventory remains limited to configured files and static ESM exports; dynamic
registration and CommonJS handler assignment are not supported. This correction does not add
control-flow or tenant-binding analysis. Reports explicitly label authorization behavior unverified.

The [route regression suite](../tests/route-evidence.test.ts) preserves detection, refusal, and
semantic-limit cases separately. A teeth result proves the declared mutation can be detected;
it does not establish complete detection of every way to violate the architectural intention.
For adoption, test real-source alternatives in your own tree and use behavioral/security tests
for the properties this extractor cannot establish.

Protect changes to blueprints, extraction scope, baselines, CI workflows, and bypass permissions
with repository review controls appropriate to your team. A required check cannot independently
protect the policy that defines that same check.

## Adapt the proof to your layout

The packaged recipes prove what BCE can observe. These six walkthroughs show how to author a draft
against files in a repository shaped like yours:

| Starting layout | Walkthrough | What changes |
|---|---|---|
| no source files yet | [empty repository](../examples/first-win/empty-repo/README.md) | proves an empty scope refuses with exit `2` before it can claim 100 |
| CommonJS with no build step | [plain JavaScript](../examples/first-win/plain-js/README.md) | scans a real `require()` without a `tsconfig` |
| TypeScript service | [TypeScript](../examples/first-win/typescript/README.md) | authors a content constraint for parameterized SQL |
| several workspace packages | [monorepo](../examples/first-win/monorepo/README.md) | narrows enforcement with `--scope-paths` |
| application and domain layers | [direct module layering](../examples/first-win/module-layering/README.md) | released C3 boundary over resolved module edges |
| Python service package and API adapter | [Python module layering](../examples/first-win/python-layering/README.md) | released structured C3 boundary with explicit import roots |

Each walkthrough executes its own documented `bce author → RED → code fix → GREEN` sequence in CI.
The hard CI ceiling is 120 seconds per layout; the front-page claim is separately bound to every
measured run staying below 60 seconds. The authored blueprint begins as `draft`; running a recipe or
authoring a draft never approves policy.

## The honest support boundary

- The released, mature TypeScript/JavaScript AST path covers Next.js route handlers, plugin
  surfaces, literal egress, paths, files, and line content.
- The `v0.3.0` release adds direct TypeScript/JavaScript and structured Python module boundaries
  with controlled GREEN/RED fixtures and measured authoring loops. They are direct-only and do not
  claim transitive reachability, cycle analysis, or independent adoption.
- The released Python import-surface MVP remains available. The Python module graph adds
  repository-module resolution and fail-closed dynamic-import uncertainty; it does not claim call
  or egress semantics.
- Content patterns can protect configuration and policy files, but BCE labels their teeth
  `evaluator-refutable`; the paired real-source mutation supplies the stronger practical proof.
- None of these mechanism demonstrations establishes that BCE improves agent success, cost,
  latency, or safety. The confirmatory efficacy study remains unrun.

## Put one boundary in your repository

After a recipe matches your intent, author the smallest draft that expresses it and install the
gate in advisory mode. Existing violations remain visible; policy approval stays human-owned.

- [Ordered onboarding](onboarding.md) — draft, review, install, and ratify one boundary.
- [Brownfield adoption](adopt-existing-repo.md) — expose debt now and tighten without a day-one wall
  of red.
- [Constraint guide](constraint-guide.md) — see the exact C1–C4 graph semantics before adapting a
  recipe.
- [TypeScript module graph](typescript-module-graph.md) — selector grammar, resolution, uncertainty,
  and honest limits for layering, runtime separation, and SDK choke points.
- [Python module graph](python-module-graph.md) — explicit roots, structured import resolution,
  fail-closed uncertainty, and honest limits.
