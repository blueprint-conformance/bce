# Portability contract

BCE's published runtime declares Node 22 and newer. The repository's source-build toolchain is pinned
to Node 22.22.2 because its locked release-signing dependency requires that patch floor. The
portability workflow tests the supported core on Ubuntu, macOS, and Windows against exact Node
22.22.2 and 24.15.0. Each matrix leg performs an exact `npm ci`, build, typecheck, cross-platform
test suite, built MCP compatibility proof, and clean packed-consumer proof.

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
