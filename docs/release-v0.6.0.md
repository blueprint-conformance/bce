# `bce-engine@0.6.0` release verification

`bce-engine@0.6.0` was published on `2026-10-24T23:03:21.574Z` from the annotated
`v0.6.0` tag and is protected by an immutable GitHub Release. This record binds the installed
registry artifact, source, provenance, six GitHub Release assets, and the consumer checks that
preceded and followed publication. Release evidence remains first-party mechanism and supply-chain
evidence.

## What changed

The release runs the engine's schemas on native Zod 4 (`zod` 4.6.7, the patched line) instead of
the `zod/v3` compatibility copy, and generates the published JSON Schemas with Zod's own
`z.toJSONSchema`. Every committed artifact parses identically, and the behavioral changes are
tightenings only: a decision timestamp must carry seconds and a `Z` or `±HH:MM` offset, and numeric
fields refuse unsafe integers and `Infinity`. No constraint type was added, so blueprints authored
for v0.5.0 keep their `minEngineVersion` floors. The declared-stack contract, stack plane, route
evidence, lifecycle, recipes, and local specification are retained from v0.5.0.

The immutable archive is a preparation snapshot: its README, guides, `release-state.json`, and
Lane-A pin still name v0.5.0 as current and v0.6.0 as the candidate. Those mutable install surfaces
are corrected by the post-publication activation PR; the released archive itself is not rewritten.

## Published identity

| Artifact | Exact identity |
|---|---|
| npm package | [`bce-engine@0.6.0`](https://www.npmjs.com/package/bce-engine/v/0.6.0) |
| Published at | `2026-10-24T23:03:21.574Z` |
| npm integrity | `sha512-iSQcNPM8RZuuqCK/M/ehnVQ9n18GNPI9YPjd9epNGMHgCjqGjn26bTw0lCreoLlOenEGTwH36DCpNwo6VCvfGA==` |
| npm shasum | `8d9f4fa22ffdb60d77ad00bb1f8fdd72399fd1e0` |
| Source and Action commit | `0f33f4c00f7d4adc37cd4379fd7a6e86b65ec7de` |
| Tag | annotated `v0.6.0`, resolving to the source commit above |
| npm provenance | SLSA provenance from [release run `40139236963`, attempt `1`](https://github.com/blueprint-conformance/bce/actions/runs/40139236963/attempts/1) |
| Canonical and evidence release | [`v0.6.0`](https://github.com/blueprint-conformance/bce/releases/tag/v0.6.0) — immutable, six assets |

The registry provenance advertises predicate type `https://slsa.dev/provenance/v1` for
`bce-engine@0.6.0`. The workflow binds the package to the source commit above and
`.github/workflows/release.yml@refs/tags/v0.6.0`. The annotated Git tag is not claimed as a
cryptographic signature.

## Immutable assets

| Asset | SHA-256 |
|---|---|
| `release-evidence-record.json` | `6398eac5fbb81b4b3984c68be59b34b84699175760b2391cc51bb95b48cdf0f8` |
| `release-evidence-record.sigstore` | `ea18d293aab9861e9b33a9df29911fad64fba180ae2fe1fa40127ef83d805c6c` |
| `release-compliance-report.json` | `a3696cc25897a0eeb4af5c48ea516d8c6ecbd208ee64a137e3e632989a858748` |
| `release-payload-manifest.json` | `7e1dfb438ce83c443b07f13b46d5a6929c4f78217d881839c6d62a1ae52fb2b7` |
| `release-payload-manifest.sigstore` | `c5e4f6c2be8649f581c34a541ed5581ddff597a8042f62a88e715074cfae4e28` |
| `bce-engine-0.6.0.tgz` | `00402da4120288abd6d97557bc643d40facad3b86fcc727fc5ec452cb0a6780a` |

The signed payload manifest records `493` package entries and manifest digest
`sha256:7d7e928a05151ccdbe9f4b18eb338b2b8ffc712fe45de9e86a751932d3934655`.
Its archive integrity and shasum match npm. The EvidenceRecord reports score `100`, verdict `pass`,
zero violations, and record hash
`83ad1aa14227d06f2e23e6f73b63496e0a6117cebde63eeff9fdd575d1d92d5d`.

## Exact installed experience

The publish job installed the final tarball into a fresh consumer before publication and exercised
the declared-stack contract from those exact bytes. A post-publication registry replay passed
**52/52 route cases** and **90/90 declared-stack cases** on macOS arm64, Node v22.22.2, and npm
10.9.7. The registry tarball was byte-identical to the immutable Release asset (SHA-256, SHA-512
integrity, and SHA-1 shasum recomputed locally). The declared-stack predecessor-refusal leg used
public `0.4.0`, the newest public engine below the declared-stack `minEngineVersion` floor of
`0.5.0`, as `scripts/package-consumer-proof.mjs` does. The bounded summaries are
[route replay evidence](../evidence/releases/v0.6.0-registry-consumer.json) and
[declared-stack replay evidence](../evidence/releases/v0.6.0-declared-stack-consumer.json).

The tag run passed `1,421` tests with `2` skipped, the self-gate, every release gate, provenance
publication, and immutable Release finalization on attempt 1. The
[portability run](https://github.com/blueprint-conformance/bce/actions/runs/40138403739) passed
on the source commit. The reviewed PR head and the published squash commit have the same Git tree
(`b4c9aa5322ec6b3fd3b5b679771edc6365670ffa`).

## Replay and limits

```bash
npm view bce-engine@0.6.0 version dist.integrity dist.shasum dist.attestations
gh release download v0.6.0 --repo blueprint-conformance/bce --dir release-assets
node scripts/route-consumer-proof.mjs --registry-version 0.6.0 \
  --out registry-proof.json --evidence-dir registry-evidence
```

Run consumer proofs with Node 22 or newer. Verify both downloaded Sigstore bundles with the
lockfile-pinned `@sigstore/cli`, using the GitHub OIDC issuer and exact tag-workflow identity above,
and compare their payloads and archive hashes with this record.

It is not independent adoption, independent review, or product-efficacy evidence. The accepted
RFC defers repair and reconciliation, and the declared-stack replay's `originAuthenticity` remains
`not-established`.
