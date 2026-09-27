# `bce-engine@0.4.0` release verification

`bce-engine@0.4.0` was published on `2026-09-27T12:16:02.924Z` from the annotated
`v0.4.0` tag and is protected by an immutable GitHub Release. This record binds the
installed registry artifact, source, provenance, six GitHub Release assets, and the
consumer checks that preceded and followed publication. Release evidence remains
first-party mechanism and supply-chain evidence.

## What changed

The released stack plane adds `bce stack snapshot`, which emits a content-addressed
`StackManifest` for the declared dependency closure, and `bce stack diff`, which classifies
changes between two manifests and fails closed on backward, rewritten, or unproven moves.
The supported inputs include npm lockfile v3/shrinkwrap, pnpm-lock v9, Dockerfile and Compose
image references, and the declared Node runtime. A read-only `stack_diff` MCP tool exposes
the classifier over already-written manifests. Cross-OS golden-byte identity and a built-CLI
RED/GREEN revision pair are part of the public portability workflow.

The release retains the route-handler evidence improvements, offline review preparation,
solo-steward lifecycle support, packaged architecture recipes, and local specification from
the preceding releases. A positive route guard observation remains syntax evidence only: it does
not prove execution on every path, awaiting, denial propagation, tenant/resource binding, or
the guard implementation.

The immutable archive is a preparation snapshot: its README, guides, `release-state.json`,
and Lane-A pin still name v0.3.1 as current and v0.4.0 as the candidate. Those mutable install
surfaces are corrected by the post-publication activation PR; the released archive itself is
not rewritten.

## Published identity

| Artifact | Exact identity |
|---|---|
| npm package | [`bce-engine@0.4.0`](https://www.npmjs.com/package/bce-engine/v/0.4.0) |
| Published at | `2026-09-27T12:16:02.924Z` |
| npm integrity | `sha512-x3W82Nn4r2cpTap8IbD9yfrcbEdbq3prQA7Ix0QioUe7P27dyTim/LjfdH6dIdkZP89XdC+RgI94sX/oMnucIg==` |
| npm shasum | `71af6d64d7307597493d9924419d9437b889cb08` |
| Source and Action commit | `91e7b05f5a3cf2734654bb060ed2b7940692cf69` |
| Tag | annotated `v0.4.0`, resolving to the source commit above |
| npm provenance | SLSA provenance from [release run `36317614581`, attempt `1`](https://github.com/blueprint-conformance/bce/actions/runs/36317614581/attempts/1) |
| Canonical and evidence release | [`v0.4.0`](https://github.com/blueprint-conformance/bce/releases/tag/v0.4.0) — immutable, six assets |

The registry provenance advertises predicate type `https://slsa.dev/provenance/v1` for
`bce-engine@0.4.0`. The release workflow binds the package to the source commit above and
`.github/workflows/release.yml@refs/tags/v0.4.0`. The annotated Git tag is not claimed as a
cryptographic signature.

## Immutable assets

| Asset | SHA-256 |
|---|---|
| `release-evidence-record.json` | `807592f45f57e8857a996d100c546d90ee6968e47a7af2dfc63bd7738703704f` |
| `release-evidence-record.sigstore` | `13a33eb18e871445003ff6020bb0a5f97ef136d843ee896b4c26a903317b2164` |
| `release-compliance-report.json` | `fef9d679e1e5c7c6523117dc6368933c6d79aebfcf00f40845b77564b63ad536` |
| `release-payload-manifest.json` | `8ca679d86950a5380005f8c39864b6ba0ba9b9abb679e5b86d48d6a70e2024b1` |
| `release-payload-manifest.sigstore` | `68925d3571baf4dd572ab09eaa2b56cee92bc4cc65bb920861a7b98ca6d99b78` |
| `bce-engine-0.4.0.tgz` | `26203cc18ce270fe69072327289bbaee4a05dd82afbf9c9361fc884f9bb16951` |

The signed payload manifest records `485` package entries and manifest digest
`sha256:7c49dba1f549977c7c7c2d66d964beac03468ca841ad59c4230fefda21e8c6cd`.
Its archive integrity and shasum match npm. The EvidenceRecord reports score `100` with verdict
`pass` over `91e7b05f5a3cf2734654bb060ed2b7940692cf69`, record hash
`38f7d484e522638241334df755fbfd61d1c4b1b4d18ebc8c8d07266148f5fee6`, and zero violations.
The tag workflow keyless-signed and verified both JSON payloads against the GitHub OIDC issuer
and exact tag workflow identity before it published the immutable Release.

## Exact installed experience

The publish job installed the one final tarball into a fresh consumer directory before publication.
It ran 52 route cases through the installed CLI, requiring enforced mode, no baseline, exact 0/1/2
outcomes, same-row handler/location evidence, and visible semantic limits in stdout and JSON.
Publication used those same verified bytes.

A post-publication exact-version registry replay then passed **52/52 cases** on macOS arm64,
Node v22.22.2, and npm 10.9.7. It independently recomputed the archive SHA-256, SHA-512 integrity,
and SHA-1 shasum; all matched the signed Release asset and npm metadata. The
[registry replay result summary](../evidence/releases/v0.4.0-registry-consumer.json) records the
bounded outcomes and a digest of the retained raw local proof. The
[tag-run consumer artifact](https://github.com/blueprint-conformance/bce/actions/runs/36317614581/artifacts/10930994352)
is supplementary Actions evidence with finite retention, not a seventh immutable Release asset.

The exact tag run passed `1,337` tests with `2` skipped, the self-gate, and every release gate.
The [portability run](https://github.com/blueprint-conformance/bce/actions/runs/36316182535)
passed Ubuntu, macOS, and Windows on Node 22 and 24. Its pull-request commit and the published
squash commit have the same Git tree. These bounded checks do not establish complete stack or route
coverage, behavioral security guarantees, or portability beyond the tested matrix.

## Release execution

The pre-tag dry run and the real tag workflow both completed successfully. The real release ran
all four jobs on attempt 1: model-controller rehearsal, the full release gate, provenance-backed npm
publication with staged evidence, and immutable GitHub Release finalization. npm metadata became
visible after the registry's normal propagation interval; the release claims were not activated
until the exact version, integrity, provenance entry, and attached assets resolved publicly.

## Replay and limits

```bash
npm view bce-engine@0.4.0 version dist.integrity dist.shasum dist.attestations
gh release download v0.4.0 --repo blueprint-conformance/bce --dir release-assets
node scripts/route-consumer-proof.mjs --registry-version 0.4.0 \
  --out registry-proof.json --evidence-dir registry-evidence
```

Run the consumer script from the verified release source with Node 22 or newer. Verify both
downloaded Sigstore bundles with the lockfile-pinned `@sigstore/cli`, using the issuer and exact
tag workflow identity above, and compare their payloads and archive hashes with this record.

It is not independent adoption, independent review, or efficacy evidence. The author-operated
pilot findings and independent-witness count are unchanged. The accepted RFC defines the stack
contract and defers repair/reconciliation; this release does not claim an autonomous repair loop.
