# `bce-engine@0.3.0` release verification

`bce-engine@0.3.0` was published on 2026-09-05 from the immutable annotated `v0.3.0`
tag. This record binds the registry artifact, source, provenance, six GitHub Release assets, and
the two fix-forward incidents without converting first-party release evidence into an adoption or
efficacy claim.

## Published identity

| Artifact | Exact identity |
|---|---|
| npm package | [`bce-engine@0.3.0`](https://www.npmjs.com/package/bce-engine/v/0.3.0) |
| Published at | `2026-09-05T19:19:09.294Z` |
| npm integrity | `sha512-KwWyEYOZu70xrQG5JYEyHNhz3eqTalno9d9+KUugytYBiWtHGO7Wpa+X/7xgi9xDc49V7OUchTJtN8Pu8T37iw==` |
| npm shasum | `00fab2060b23460d9ac0489610eb0fec7b5a8d57` |
| Source and Action commit | `9fe4a02d39c05dbdf280b359e9b364de84e1eda8` |
| Tag | annotated `v0.3.0`, resolving to the source commit above |
| npm provenance | SLSA provenance from [release run 33986090613, attempt 2](https://github.com/blueprint-conformance/bce/actions/runs/33986090613/attempts/2) |
| Canonical and evidence release | [`v0.3.0`](https://github.com/blueprint-conformance/bce/releases/tag/v0.3.0) — immutable, six assets |

The registry exposes two attestations, including SLSA provenance whose subject is
`pkg:npm/bce-engine@0.3.0`. It binds the package digest to
`.github/workflows/release.yml@refs/tags/v0.3.0`, the source commit above, and attempt 2 of the
linked GitHub Actions run. The annotated Git tag is not claimed as a cryptographic signature.

## Immutable assets

The canonical Release contains exactly these six uploaded assets:

| Asset | SHA-256 |
|---|---|
| `release-evidence-record.json` | `74a1714f4f574e9766b7c8f276a08d1c76338483ef4c75547e11ce6e5e1fba92` |
| `release-evidence-record.sigstore` | `559ecac5d4d7ab57eb34262563012f1f150f3dadf6ebb18b5f50d34bd807c4e3` |
| `release-compliance-report.json` | `4d34f974e3d6c54e1242c711b612e289b02860884391531b5d097ae4ab76dda3` |
| `release-payload-manifest.json` | `5e04388ad94070dad1208eecf0f75e4ff8dd7253bee532cc581e0ceb7aff29f3` |
| `release-payload-manifest.sigstore` | `e87542187ae1aa994782c52e330db5aeeebd3cefe1831c268a316f89bcbe1e91` |
| `bce-engine-0.3.0.tgz` | `cfa6629ba8d64d34e447e18a9e896e174ff66d94a38ff03c12645cab2c5625d9` |

The signed payload manifest records 393 package entries, npm integrity and shasum identical to the
registry values above, and manifest digest
`sha256:ffafc9ef7b5468a0248b0ea7f4b1046673f6b39ccfc848218dc2474f03e7aa33`.
The EvidenceRecord is a score-100 pass over source `9fe4a02d39c05dbdf280b359e9b364de84e1eda8`
with chain hash `475688ae528309bfb261f2cd0c72fecb183ad6b23d60ae8392c76752eda806d9`.

Both bundles verify against:

- certificate issuer: `https://token.actions.githubusercontent.com`;
- certificate identity: `https://github.com/blueprint-conformance/bce/.github/workflows/release.yml@refs/tags/v0.3.0`.

Their Rekor log indexes are
[`2729653987`](https://search.sigstore.dev/?logIndex=2729653987) for the EvidenceRecord and
[`2729655622`](https://search.sigstore.dev/?logIndex=2729655622) for the payload manifest.

## Incidents and fix-forward

The tag's release gate and macOS controller passed. Attempt 1 then created and verified the first
Sigstore attestation, but the second attestation timed out while creating its Rekor entry. The job
failed before a draft Release existed and before npm publication. Registry and GitHub state were
checked as absent, then only failed jobs were rerun against the same tag and source commit.

Attempt 2 generated and verified both bundles, staged all six digest-bound assets on a draft, and
published the exact attached tarball to npm with provenance. The isolated finalizer then failed
before publishing the draft because it intentionally had no checkout while its `gh release view`
call omitted an explicit repository target; GitHub CLI reported `fatal: not a git repository`.
The npm version was not republished.

Before the draft was manually finalized, all six assets were downloaded and matched byte-for-byte
to the publish job's SHA-256 outputs. Both Sigstore identities verified, the tarball's SHA-512 and
SHA-1 matched npm, its package name/version matched `bce-engine@0.3.0`, the payload manifest matched
the registry, and the EvidenceRecord chain verified at score 100. The intended finalizer operation
was then run with an explicit `--repo blueprint-conformance/bce`; the resulting Release reported
`isDraft=false`, `isImmutable=true`, and the same six asset digests.

[PR #66](https://github.com/blueprint-conformance/bce/pull/66) fixes the checkout-free finalizer and
adds a release-policy negative control that rejects repository inference. The Actions attempt stays
visibly failed at its finalizer step; this record does not rewrite that history.

## Independent replay

Registry identity can be checked without trusting this page:

```bash
npm view bce-engine@0.3.0 version dist.integrity dist.shasum dist.attestations
npm pack bce-engine@0.3.0
printf 'sha512-%s\n' "$(openssl dgst -sha512 -binary bce-engine-0.3.0.tgz | openssl base64 -A)"
shasum -a 1 bce-engine-0.3.0.tgz
```

Download and verify the immutable Release assets from a clean source checkout:

```bash
gh release download v0.3.0 --repo blueprint-conformance/bce
shasum -a 256 release-evidence-record.json release-evidence-record.sigstore \
  release-compliance-report.json release-payload-manifest.json \
  release-payload-manifest.sigstore bce-engine-0.3.0.tgz
npm ci
node node_modules/@sigstore/cli/bin/run verify \
  release-evidence-record.sigstore \
  --certificate-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-uri https://github.com/blueprint-conformance/bce/.github/workflows/release.yml@refs/tags/v0.3.0
node node_modules/@sigstore/cli/bin/run verify \
  release-payload-manifest.sigstore \
  --certificate-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-uri https://github.com/blueprint-conformance/bce/.github/workflows/release.yml@refs/tags/v0.3.0
```

This is release-supply-chain and deterministic-mechanism evidence. It is not independent adoption,
private-product dogfood, or efficacy evidence, and it does not enter the sealed comparative-study
outcome ledger.
