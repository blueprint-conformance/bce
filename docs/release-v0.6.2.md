# `bce-engine@0.6.2` release verification

`bce-engine@0.6.2` was published on `2026-11-08T15:30:59.990Z` from the annotated
`v0.6.2` tag and is protected by an immutable GitHub Release. This record binds the installed
registry artifact, source, provenance, six GitHub Release assets, and the consumer checks that
preceded and followed publication. Release evidence remains first-party mechanism and supply-chain
evidence.

## What changed

The release is v0.6.1 plus two consumer-facing fixes; it adds no constraint vocabulary and changes
no runtime dependency version.

- **A production-only published `npm-shrinkwrap.json`** ([#145](https://github.com/blueprint-conformance/bce/pull/145)).
  npm installs every entry of a dependency's published shrinkwrap, including entries marked
  `"dev": true`, whenever the registry packument says `_hasShrinkwrap`. v0.6.1 shipped the
  repository's full development lock, so `npm install -D bce-engine@0.6.1` installed 184 nested
  packages (202 MB on disk), including vitest, rolldown, oclif, the MCP inspector, and the sigstore
  CLI. v0.6.2 publishes the runtime tree only: 16 lock entries, 0 development entries. The release
  and rehearsal workflows prune the lock immediately before the single `npm pack`;
  `verify-release-payload` refuses a tarball whose packed shrinkwrap carries any development entry;
  and the build bakes the digest of that production-only form, so evidence `toolchain.dependencyLock`
  names the bytes a consumer installs. Local-tarball installs never read a dependency's shrinkwrap,
  which is why the earlier tarball-based consumer proofs could not see the defect.
- **npm identification on Windows when emitting evidence** ([#142](https://github.com/blueprint-conformance/bce/pull/142)).
  The engine's npm-version probe now finds `npm.cmd`, so `run --emit-bundle` no longer refuses on a
  direct `node` invocation on Windows.

`COMPILER_ENGINE_VERSION` is `0.6.2`. Blueprints that use `forbiddenDependencyPath` still declare
`minEngineVersion` `0.6.1`; that floor is unchanged.

The immutable archive is a preparation snapshot: its README, guides, and `release-state.json`
still name v0.6.1 as current and v0.6.2 as the candidate (the Lane-A pin, `.engine-pin.json`, is a
repository file and is not in the archive). Those mutable install surfaces and the pin are corrected
by the post-publication activation PR; the released archive itself is not rewritten.

## Published identity

| Artifact | Exact identity |
|---|---|
| npm package | [`bce-engine@0.6.2`](https://www.npmjs.com/package/bce-engine/v/0.6.2) |
| Published at | `2026-11-08T15:30:59.990Z` |
| npm integrity | `sha512-ld3LEyKp6o5hxVDxfgjH6KnKHmKXGFHZwZhcXONb5WtCSs4dAtCSR/ep2s7OXlvAe9IkqKIdOFPvvjaUQJWN5A==` |
| npm shasum | `0b2a24b27e76c37e2507005959906021178dfeec` |
| Source and Action commit | `17be7a3d25ca1db62be58ce88d6c16d7e35cd3ac` |
| Tag | annotated `v0.6.2`, resolving to the source commit above |
| npm provenance | SLSA provenance from [release run `42493918390`, attempt `1`](https://github.com/blueprint-conformance/bce/actions/runs/42493918390/attempts/1) |
| Canonical and evidence release | [`v0.6.2`](https://github.com/blueprint-conformance/bce/releases/tag/v0.6.2) — immutable, six assets |

The workflow binds the package to the source commit above and
`.github/workflows/release.yml@refs/tags/v0.6.2`; npm reported "Signed provenance statement with
source and build information from GitHub Actions" at publication. The annotated Git tag is not
claimed as a cryptographic signature. The tag run completed every job on its first attempt.

## Immutable assets

| Asset | SHA-256 |
|---|---|
| `release-evidence-record.json` | `a03246729e23cf44740cdf032c1291ad013d54306415965f7626354a4bca72af` |
| `release-evidence-record.sigstore` | `4f327f35784d320d336c75c5c8088cfad252d0189fabc69a3cd2f80b692bc984` |
| `release-compliance-report.json` | `6d195bd6653b8830e2fe655a8959ee721f0f520d9d6c1bb9c7841c1b28db03d8` |
| `release-payload-manifest.json` | `d4f0f690fc0e9a469948bdd41c01138b71344fdda325adddb58ca27a894fda7f` |
| `release-payload-manifest.sigstore` | `f0fed3fdd1f6ed3f6430d871ff800012d63f07e3f301a7e1577455a46407329e` |
| `bce-engine-0.6.2.tgz` | `f6f951b54a5940d79fab62ee67cef6fe6fa6819cf476743e60035a38a368bba4` |

The signed payload manifest records `531` package entries and manifest digest
`sha256:a4920dd7cda36f5db69dd56c0f1d2f1264afae50c7356bc9751c725193c11d4f`; every archive path and
size matches that inventory (checked on Windows, where file modes are not meaningful). Its archive
integrity matches npm. Both Sigstore bundles verify with the lockfile-pinned `@sigstore/cli` against
the GitHub OIDC issuer and the exact tag-workflow identity above, and each signed DSSE payload is
byte-identical to its attached JSON. The EvidenceRecord reports score `100`, verdict `pass`, and
record hash `3737d0b1f0f90bfe8d9a8544a63ed50631341eb9636e032a132a3420751e419b`.

## Exact installed experience

The publish job installed the final tarball into a fresh consumer before publication and exercised
the declared-stack contract from those exact bytes. A post-publication registry replay passed
**52/52 route cases** and **90/90 declared-stack cases** on Windows x64, Node v22.19.0, and npm
10.9.3. The registry tarball was byte-identical to the immutable Release asset (SHA-256 above). The
declared-stack predecessor-refusal leg used public `0.4.0`, as `scripts/package-consumer-proof.mjs`
does. Unlike v0.6.1, the declared-stack replay ran through a direct `node` invocation. The bounded
summaries are [route replay evidence](../evidence/releases/v0.6.2-registry-consumer.json) and
[declared-stack replay evidence](../evidence/releases/v0.6.2-declared-stack-consumer.json).

Install footprint, measured from the public registry into empty projects with empty npm caches
(`npm install -D -E`, Windows x64, Node v22.19.0, npm 10.9.3):

| Version | `node_modules` | Nested packages | Dev toolchain present | `bce demo --recipe module-layering` |
|---|---|---|---|---|
| `0.6.1` | 202 MB | 184 | yes (vitest, rolldown, …) | GREEN/RED |
| `0.6.2` | 43 MB | 11 | no | GREEN/RED |

The tag run passed `1,551` tests with `2` skipped, the self-gate, every release gate, provenance
publication, and immutable Release finalization. The
[portability run](https://github.com/blueprint-conformance/bce/actions/runs/42493918349) passed
on the source commit. The reviewed PR head (`c8d72dd`) and the published squash commit have the same Git tree
(`982f568dd264976bb829405173f31b86537e4e69`).

## Replay and limits

```bash
npm view bce-engine@0.6.2 version dist.integrity dist.shasum dist.attestations
gh release download v0.6.2 --repo blueprint-conformance/bce --dir release-assets
node scripts/route-consumer-proof.mjs --registry-version 0.6.2 \
  --out registry-proof.json --evidence-dir registry-evidence
```

Run consumer proofs with Node 22 or newer. Verify both downloaded Sigstore bundles with the
lockfile-pinned `@sigstore/cli`, using the GitHub OIDC issuer and exact tag-workflow identity above,
and compare their payloads and archive hashes with this record.

It is not independent adoption, independent review, or product-efficacy evidence. The declared-stack
replay's `originAuthenticity` remains `not-established`. Do not pin v0.6.1 for new installs: it
carries the same runtime as v0.6.2 but installs the development toolchain.
