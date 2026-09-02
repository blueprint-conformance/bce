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
