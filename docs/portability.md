# Portability contract

BCE's published runtime declares Node 22 and newer. The repository's source-build toolchain is pinned
to Node 22.23.4 because its locked release-signing dependency requires that patch floor. The
portability workflow tests the supported core on Ubuntu, macOS, and Windows against exact Node
22.23.4 and 24.22.1. Each matrix leg performs an exact `npm ci`, build, typecheck, cross-platform
test suite, built MCP compatibility proof, a stack-manifest cross-OS golden-byte-identity proof
(see [`docs/stack-plane.md`](stack-plane.md)), and clean packed-consumer proof.

Frozen-source reads (pinned `run`, `architecture-review`, `policy-impact`, and stack snapshots at a
revision) need Git 2.32 or newer, the first release that honours `GIT_CONFIG_GLOBAL`. Older Git
would read the caller's global configuration, so BCE refuses with exit 2 and names the floor instead.

The cross-platform suite excludes three intentionally Unix-specific integration contracts: the POSIX pre-commit hook, the shell-based Agent Skill scanner, and the repository self-gate shell harness. Those integrations remain release-gated on Ubuntu; their exclusion does not remove engine, CLI, evidence, or MCP coverage from Windows or macOS.

## Claim boundary

Adding a workflow is not evidence that its matrix passed. A platform/version combination is supported publicly only after the workflow has completed successfully on the relevant source revision. Until the first public run completes, the matrix is configured but unverified.

Every matrix leg also imports a test-only network-denial hook that throws on Node socket, TLS,
DNS, HTTP(S), or global-fetch access. Its negative probe must be refused, then built BCE validation,
GREEN and RED gates, evidence-chain verification, and MCP discovery must succeed with hostile
HTTP/HTTPS/ALL proxy and npm-registry settings. This proves those runtime paths stay local after
installation; it does not prove a cold package install can succeed without registry artifacts.

Cold installation still depends on the configured npm-compatible registry serving every locked
artifact. Authentication against a particular enterprise registry is not claimed until exercised
against that registry; the proof only establishes that runtime execution neither bypasses nor needs it.

## Public install path

The matrix above proves the source tree and a tarball packed from it. It does not prove what a new
user gets. The non-required `public-install` workflow (`.github/workflows/public-install.yml`) runs
on a daily schedule, on manual dispatch, after the `release` workflow completes, and on pull
requests that change the install documents or `.engine-pin.json`. On Ubuntu, macOS, and Windows,
with Node 22 and 24, it installs the exact version named in `.engine-pin.json` from the public npm
registry into empty directories with a cold npm cache. It then runs the fenced commands from the
README "Run a real gate" section, `docs/quickstart.md`, and `examples/quickstart/README.md`.

`scripts/public-install-walkthrough.mjs` extracts those commands from the documents, so a
document that drifts from what works fails the leg. Each command must exit with its documented code:
GREEN gates exit 0 with `0 failing`, and the drifted gate exits 1 naming the forbidden `axios` edge
at `src/greeting.plugin.ts#L16`. Windows runs the commands in PowerShell, using a document's
`powershell` block in place of the `bash` block directly before it; Linux and macOS use bash. A
last step checks that every lockfile resolved the pinned registry tarball with the pinned integrity.

Like the matrix, this workflow is evidence only after it has completed successfully on the relevant
revision. It depends on registry availability, so it is not a required check.

## Full doctor integration budget

The repository doctor integration test executes the complete live-source mutation corpus for both
self-adoption blueprints (47 engine constraints and 13 skill constraints), followed by the full gate.
It has a five-minute functional-test budget. It must report extractor-real proof for both blueprints
with every source mutant killed; evaluator-only evidence cannot satisfy this test.

This budget corrects the [failed post-merge Windows/Node 22 run at `ea97bbe`](https://github.com/blueprint-conformance/bce/actions/runs/34052319358/job/101538010342):
the doctor test took 121.4 seconds under parallel suite load against its former 120-second limit.
The Windows/Node 24 leg took 114.3 seconds. The correction retains the full corpus, platform matrix,
assertions, and ordinary test timeout. It adds no retries. This integration deadline is not a claim
about interactive response time; the separate runtime performance proofs retain their own budgets.

A passing PR run does not establish post-merge health. Release verification must wait for all
release-relevant workflows, including all six portability legs, to finish on the merged `main`
revision. The [live pipeline](live-self-adoption.md) continues to display the observed revision's
actual result, including failures and pending checks.

## Documentation proof budget

The documentation self-test stages a fresh tree and rebuilds the site for each control. Its budget
scales at 16 seconds per control, with a ten-minute ceiling. Every planted defect must still be
refused for its intended reason, and the clean tree and positive controls must still build.

The [post-merge Windows/Node 24 run at `09e8608`](https://github.com/blueprint-conformance/bce/actions/runs/34064098402/job/101569716183)
completed the doctor proof in 99 seconds, then failed because the documentation proof took 284.7
seconds against its former 240-second ceiling. This separate timeout was found by waiting for the
entire post-merge matrix. The documentation budget now accounts for the cost of repeatedly copying
and rebuilding the full site on supported runners; the correction adds no retries, exclusions, or
changes to production performance budgets.
