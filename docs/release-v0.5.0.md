# `bce-engine@0.5.0` release verification

`bce-engine@0.5.0` was published on `2026-09-27T14:32:21.158Z` from the annotated
`v0.5.0` tag and is protected by an immutable GitHub Release. This record binds the installed
registry artifact, source, provenance, six GitHub Release assets, and the consumer checks that
preceded and followed publication. Release evidence remains first-party mechanism and supply-chain
evidence.

## What changed

The release adds the enforcement half of RFC-0002 to the existing stack plane. An authored
blueprint can select exact npm-v3 or root pnpm-v9 lockfiles, `package.json`, image files, and Node
runtime files, then enforce `pinnedVersion`, `stackClosureMatch`, `forbiddenStackPackage`,
`requirePinnedImages`, and `allowedNodeVersions` through the ordinary gate, `run`, and read-only MCP
paths. Missing, opaque, variable, conflicting, or integrity-invalid required evidence refuses.
Version 2 offline bundles bind the stack manifest and source facts, re-evaluate the report, and
refuse manifest substitution or tampering.

The declared-stack contract observes selected declarations. It does not prove installed state,
registry origin, deployed state, or runtime behavior. It does not resolve registries, mutate
declarations, reconcile stacks, or apply repairs. The release retains the standalone snapshot/diff
plane, route evidence, lifecycle, recipes, and local specification from preceding releases.

The immutable archive is a preparation snapshot: its README, guides, `release-state.json`, and
Lane-A pin still name v0.4.0 as current and v0.5.0 as the candidate. Those mutable install surfaces
are corrected by the post-publication activation PR; the released archive itself is not rewritten.

## Published identity

| Artifact | Exact identity |
|---|---|
| npm package | [`bce-engine@0.5.0`](https://www.npmjs.com/package/bce-engine/v/0.5.0) |
| Published at | `2026-09-27T14:32:21.158Z` |
| npm integrity | `sha512-Uq1nWo6SR/xJUDCCiDXdoK+1RrnDm4/0z++brj5gsJlBOwpHdISxSH/p21ZqSFmaggXp7DB53AJpZKT2I9Xd9A==` |
| npm shasum | `5613a98691ee0319c518755e7af225f2ac7e7b2d` |
| Source and Action commit | `bbc898156fa5d41b89d5a09c566f4e50481ccf63` |
| Tag | annotated `v0.5.0`, resolving to the source commit above |
| npm provenance | SLSA provenance from [release run `36325500098`, attempt `1`](https://github.com/blueprint-conformance/bce/actions/runs/36325500098/attempts/1) |
| Canonical and evidence release | [`v0.5.0`](https://github.com/blueprint-conformance/bce/releases/tag/v0.5.0) — immutable, six assets |

The registry provenance advertises predicate type `https://slsa.dev/provenance/v1` for
`bce-engine@0.5.0`. The workflow binds the package to the source commit above and
`.github/workflows/release.yml@refs/tags/v0.5.0`. The annotated Git tag is not claimed as a
cryptographic signature.

## Immutable assets

| Asset | SHA-256 |
|---|---|
| `release-evidence-record.json` | `f7ef55d0102b307b669bafa3020e34449d6e3eb1b8f5d8486144c84348e985b8` |
| `release-evidence-record.sigstore` | `22c214563807b2878cbb455c1307464cb2d6310d653be3ee99a3e424fe26ba9d` |
| `release-compliance-report.json` | `0fdc0a6a12538574e074af8a5086421d105b9d1b8923df53ffc30e6971254877` |
| `release-payload-manifest.json` | `76867b6ffa569397b3f3b254f662975624e71c03a3de7519a3153ed4979c4cbc` |
| `release-payload-manifest.sigstore` | `2e7c5866e57671013d5c24ed2dd363fba892df29df7178847239d506820202c0` |
| `bce-engine-0.5.0.tgz` | `2002ca9a8ce3f95e96e9653720d2a7244baf090acf15bf4a0c8a1d45f2cd4b1d` |

The signed payload manifest records `492` package entries and manifest digest
`sha256:42fa8549b4d13e0bba5dcf89fa22347f516a507ce4468dd40c784e501600560a`.
Its archive integrity and shasum match npm. The EvidenceRecord reports score `100`, verdict `pass`,
zero violations, source `bbc898156fa5d41b89d5a09c566f4e50481ccf63`, and record hash
`e86c8bbbae0a12885d655346a0debf8eca1f814566b94fb97724b09d99397814`.

## Exact installed experience

The publish job installed the final tarball into a fresh consumer before publication and exercised
the declared-stack contract from those exact bytes. A post-publication registry replay passed
**52/52 route cases** and **90/90 declared-stack cases** on macOS arm64, Node v22.22.2, and npm
10.9.7. It independently recomputed the archive SHA-256, SHA-512 integrity, and SHA-1 shasum; the
registry tarball was byte-identical to the immutable Release asset. The bounded summaries are
[route replay evidence](../evidence/releases/v0.5.0-registry-consumer.json) and
[declared-stack replay evidence](../evidence/releases/v0.5.0-declared-stack-consumer.json).

The first post-publication declared-stack replay correctly exposed a proof-harness literal that
still expected predecessor `0.3.1`. The activation PR changes the package proof to install the
actual predecessor `0.4.0` and derives the refusal message from that installed package. The rerun
then passed 90/90 using public 0.5.0 runtime bytes and public 0.4.0 predecessor bytes. This was a
test-harness identity assertion, not an engine verdict failure; immutable 0.5.0 bytes are unchanged.

The tag run passed `1,412` tests with `2` skipped, the self-gate, every release gate, provenance
publication, and immutable Release finalization on attempt 1. The
[portability run](https://github.com/blueprint-conformance/bce/actions/runs/36324003262) passed
Ubuntu, macOS, and Windows on Node 22 and 24. The reviewed PR and published squash commit have the
same Git tree.

## Replay and limits

```bash
npm view bce-engine@0.5.0 version dist.integrity dist.shasum dist.attestations
gh release download v0.5.0 --repo blueprint-conformance/bce --dir release-assets
node scripts/route-consumer-proof.mjs --registry-version 0.5.0 \
  --out registry-proof.json --evidence-dir registry-evidence
```

Run consumer proofs with Node 22 or newer. Verify both downloaded Sigstore bundles with the
lockfile-pinned `@sigstore/cli`, using the GitHub OIDC issuer and exact tag-workflow identity above,
and compare their payloads and archive hashes with this record.

It is not independent adoption, independent review, or product-efficacy evidence. The accepted
RFC defers repair and reconciliation, and the declared-stack replay's `originAuthenticity` remains
`not-established`.
