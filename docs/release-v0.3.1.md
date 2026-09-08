# `bce-engine@0.3.1` release verification

`bce-engine@0.3.1` was published on `2026-09-08T03:29:56.894Z` from the annotated `v0.3.1`
tag, protected by the immutable GitHub Release. This record binds the installed registry artifact, source, provenance, six GitHub Release
assets and the consumer checks that preceded publication. Release evidence remains first-party
mechanism and supply-chain evidence.

## What changed

The route extractor now inventories direct named function exports and immutable `const` arrow or
function-expression exports for GET, POST, PUT, PATCH, DELETE, HEAD and OPTIONS. Relevant unsupported
exports, reassigned handler bindings and statically recognized CommonJS handler assignments refuse
with a source location. JavaScript and TypeScript preserve the same canonical handler identity and
their original evidence locations; colliding canonical handlers refuse instead of sharing evidence.

A positive guard-presence observation still means a configured governed call site was observed in handler syntax.
It does not prove execution on every path, awaiting, denial propagation, tenant/resource binding
or the guard implementation. Green CLI output and JSON reports now state **authorization behavior
unverified**. The [route evidence boundary](first-win.md#route-guard-evidence-boundary) preserves
v0.3.0's omission limitation and the remaining supported scope.

This release also packages changes merged after v0.3.0: offline `review prepare`, explicit
base-authorized solo-steward ratification and lifecycle audits, plus local `spec/SPEC.md`.
The default non-author review policy remains; an authorized solo-steward decision is explicitly
self-ratified. The packaged agent-start and lifecycle guidance distinguish available functionality from
historical v0.3.0 limits and the engine separately selected for CI.

The immutable archive also retains a preparation snapshot: its README, First Win guide, and
`release-state.json` still name v0.3.0 as the current registry selection and v0.3.1 as the candidate.
Those snapshot install commands are stale after publication. An installed v0.3.1 user should keep
that version and use `npx --no-install bce demo`; the [current First Win guide](first-win.md)
selects v0.3.1. The post-publication website/pin update does not alter the released archive.

## Published identity

| Artifact | Exact identity |
|---|---|
| npm package | [`bce-engine@0.3.1`](https://www.npmjs.com/package/bce-engine/v/0.3.1) |
| Published at | `2026-09-08T03:29:56.894Z` |
| npm integrity | `sha512-hRWp4UvxWS7XnifOfrjRSxhIhUh8KB8n0I79Kyw6ffgSuH1s3aAwCVNapnsRIOH1rPXzxo/gTMMuyQewzgsrCg==` |
| npm shasum | `1f71f5221bcc7cc1e29728d2339abb4046f2d701` |
| Source and Action commit | `7fc24fe24c3eb41366be990023ea37b00d2ca3b8` |
| Tag | annotated `v0.3.1`, resolving to the source commit above |
| npm provenance | SLSA provenance from [release run `34183200847`, attempt `1`](https://github.com/blueprint-conformance/bce/actions/runs/34183200847/attempts/1) |
| Canonical and evidence release | [`v0.3.1`](https://github.com/blueprint-conformance/bce/releases/tag/v0.3.1) — immutable, six assets |

The verified registry provenance binds `pkg:npm/bce-engine@0.3.1` and its digest to the source
commit above and `.github/workflows/release.yml@refs/tags/v0.3.1`. The annotated Git tag is not
claimed as a cryptographic signature.

## Immutable assets

| Asset | SHA-256 |
|---|---|
| `release-evidence-record.json` | `c53c608d6e4016bb9c9452c4b611f9d3c2f187ebb63142971187e1bd56cc78a8` |
| `release-evidence-record.sigstore` | `e185a5c1dd5047ea3904f46c1f4f75d92279a3fc30ce7fa8a5b2b7b94982f332` |
| `release-compliance-report.json` | `b6b1c2a5cb7326610c372d7486d0abad5ff165898d75654f84f7222401688595` |
| `release-payload-manifest.json` | `0c7931af20ef6dd1be3fdd9cf090ced1d9a3d09a3c8359890a53d083739f66b1` |
| `release-payload-manifest.sigstore` | `95b54bbeccaedf26d155641e85d3311d48bbdf012c17eb15f7995064d4e5476b` |
| `bce-engine-0.3.1.tgz` | `bd5ed95e2e83a6a8910be0326920f08362c8463a122d146749df940fdf540e97` |

The signed payload manifest records `400` package entries and manifest digest
`sha256:9f61740c7b58451b7505d7c69dc7241249e3761f5a8450c641e90f8c878736de`. Its archive integrity and shasum match npm. The EvidenceRecord reports
`score 100 (pass)` over `7fc24fe24c3eb41366be990023ea37b00d2ca3b8` with chain hash `8fe25d972852a0d63c6708b32c3abacaf824ec12443f0cc69f055bef7a72c88e`.
Both Sigstore bundles verify against issuer `https://token.actions.githubusercontent.com` and
certificate identity `https://github.com/blueprint-conformance/bce/.github/workflows/release.yml@refs/tags/v0.3.1`.
Their authenticated payloads match the corresponding attached JSON files.

## Exact installed experience

The publish job installed the one final tarball into a fresh consumer directory and ran **52 route
cases through its installed CLI**, requiring enforced mode, no baseline, exact 0/1/2 outcomes,
same-row handler/location evidence, and visible semantic limits in stdout and JSON. It neither
rebuilt nor repacked the supplied archive and checked its digest before and after the proof.
Publication used those same verified bytes.

An exact-version fresh registry replay then passed **52/52 cases** on macOS arm64, Node v22.22.2 and npm 10.9.7 and matched the signed
tarball identity. [Final tag-run consumer evidence](https://github.com/blueprint-conformance/bce/actions/runs/34183200847/artifacts/10039768511) and
[registry replay result summary](../evidence/releases/v0.3.1-registry-consumer.json) record artifact identity and results.
The registry summary contains all 52 outcomes and a digest of the retained private raw proof; it
is not a public copy of that raw local bundle. A separate npm 11.19.1 `npm audit signatures`
verified all 15 installed packages’ registry signatures and four attestations.
The Actions consumer bundle contains the proof script, dependency lock, case source, unchanged or
explicitly JS-scoped blueprints, stdout, stderr, JSON reports and file digests. It is supplementary
run evidence with 90-day Actions retention, not a seventh immutable Release asset.

The exact final source passed `1,039` tests, the self-gate and all required
release checks. The [portability run](https://github.com/blueprint-conformance/bce/actions/runs/34182691758) passed Ubuntu, macOS and
Windows on Node 22 and 24. These bounded checks do not establish complete route coverage beyond the
documented static scope or behavioral security guarantees.

## Rehearsal failure and forward correction

[Rehearsal 34181214664](https://github.com/blueprint-conformance/bce/actions/runs/34181214664), at
`8ff63926bc264cf7bd4a409cac54c16282bcb4d4`, failed its installed-archive proof at **50/51** cases.
The JavaScript missing-guard case exited red, but its handler identity did not meet the expected
same-row canonical identity/location contract. The failure was retained and publication did not occur.

The correction preserved route identity across language extensions, refused duplicate canonical
handlers, and added a collision case. [Rehearsal 34181788989](https://github.com/blueprint-conformance/bce/actions/runs/34181788989),
at `c8091217efddf0c60023f522da08b09f9c5f4491`, then passed **52/52** installed-archive cases.
Later wording and mutation-precondition changes were followed by
[the final rehearsal](https://github.com/blueprint-conformance/bce/actions/runs/34182171765) at `37a1fc8180d481e99288f450506120376577d301` and the real
tag-run verification linked above. Earlier candidate archive digests are not the release identity.

The earlier successful rehearsal's concluding banner overstated its scope; the forward correction
describes it precisely. Rehearsal exercises install/build, the exact archive consumer, npm dry-run
and local evidence generation. It does not establish accepted registry authorization/provenance,
Sigstore signing or immutable publication. The actual v0.3.1 release workflow completed all four jobs successfully on attempt 1; no publish
retry or manual finalization was needed.

## Replay and limits

```bash
npm view bce-engine@0.3.1 version dist.integrity dist.shasum dist.attestations
gh release download v0.3.1 --repo blueprint-conformance/bce --dir release-assets
node scripts/route-consumer-proof.mjs --registry-version 0.3.1 \
  --out registry-proof.json --evidence-dir registry-evidence
```

Run the consumer script from the verified release source with Node 22 or newer. Verify both
downloaded Sigstore bundles with the lockfile-pinned `@sigstore/cli`, using the issuer and exact
tag workflow identity above, and compare their payloads and archive hashes with this record.

It is not independent adoption, independent review, or efficacy evidence. The author-operated
pilot findings and independent-witness count are unchanged. The draft paper PDF is unchanged;
its reading note and the route guide explain why syntax checks must not be read as authentication
or tenant-isolation guarantees.
