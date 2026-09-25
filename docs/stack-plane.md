# Stack plane, slice 1 — [RUNS]

The stack plane is a sibling evidence class to the observed architecture graph and the compliance
report: it pins the DECLARED dependency closure of a repository — every direct and transitive
package, the declared node runtime, and any Dockerfile/compose image references — as a
content-addressed artifact. It does not join the graph or the compliance report in this slice, and
no blueprint constraint type grades it yet. See [`spec/SPEC.md` §16](../spec/SPEC.md) for the
normative format.

## `bce stack snapshot` — the manifest

```bash
node dist/cli.js stack snapshot --ct-repo <dir> [--ref <sha|ref>] [--no-pin] [--out <path>]
```

Reads, from the pinned tree and nothing else: `npm-shrinkwrap.json` or `package-lock.json` with
`lockfileVersion` **3 only** (shrinkwrap wins when both exist); `pnpm-lock.yaml` with
`lockfileVersion` **`'9.0'` only**, read through a hand-rolled YAML-subset reader — no YAML
dependency; `package.json`; `.nvmrc` / `.node-version`; and `Dockerfile*` / `docker-compose*` /
`compose*` `image:` lines. Never `node_modules`, never the network, never the machine's own
platform/arch/npm version. A symlinked source, a hollow lockfile, or a malformed/wrong-version
lockfile refuses (exit 2) — the manifest is a function of the revision, or it is not written at all.

The output is a `StackManifest`: nodes keyed by `(kind, name, version, integrity)`, a
`stackDigest` (sha256 over a canonicalized hashed view of nodes/runtime/images/unmodeled) and the
human handle `stackId` (`stack:` + the first 12 hex of the digest). The digest quarantines the
revision, declared version ranges, hoisting layout, and coverage — none of those can move it,
so the SAME closure at two different commits produces the SAME digest (see the `e0f7344` ≡
`a949557` pair below).

## `bce stack diff` — the closure classifier

```bash
node dist/cli.js stack diff --from <A.stack.json> --to <B.stack.json> [--out <path>]
```

Classifies every move between two manifests, per name (never per `name@version`): `added` /
`removed` / `forward` / `backward` / `rewritten` / `flags-changed` / `spec-changed` / `unknown`.
Inputs are manifests, never repositories — a file that fails schema validation, is a symbolic
link, or whose recorded digests do not re-derive is refused (exit 2, nothing written). The report's
top `classification` is the MAX-RANK move present (`backward > unknown > rewritten|flags-changed >
added|removed > forward > spec-changed > identical`); `backward`, `rewritten`, and an
install-script gain all exit **2** ("fails closed" — an explicit acknowledged rationale is
required, never a silent pass). See [`spec/SPEC.md` §16.2](../spec/SPEC.md) for the full join and
set-matching rules.

The measured seed table — `47a51f4 → a949557`/`e0f7344` (this repository's own vitest 4 → 5 bump):
7 forward version moves, 1 added copy (`magic-string@1.3.1` beside the retained `0.30.21`), 7
removed names, top classification `removed` (the rank rule: 7 removed outranks 7 forward). The
reverse direction is the mirror image and fails closed on 7 `backward` moves, exit 2.

## What is [RUNS] as of 0.4.0

- The manifest verb, the npm and pnpm-lock v9 extractors, and the golden-pinned determinism suites
  (`tests/stack-determinism.test.ts`, `tests/stack-pnpm.test.ts`) run under the vitest suite on
  every push.
- **Cross-OS golden-byte-identity** (`scripts/stack-cross-os-golden-proof.mjs`, wired into
  [`.github/workflows/portability.yml`](../.github/workflows/portability.yml)): `stack snapshot
  --no-pin` over the committed `fixtures/stack/a949557-tree/` fixture must reproduce
  `fixtures/stack/a949557.stack.json` — the WHOLE manifest, not only `stackDigest` — on
  ubuntu-latest, macos-latest AND windows-latest. This is what turns the council's cross-OS
  determinism prediction into a measured, running fact rather than a design claim.
- **The built-dist Stack RED/GREEN discriminating pair**
  ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml), beside the existing offline
  RED/GREEN leg): the GREEN leg materializes the real revisions `47a51f4` and `e0f7344` via
  `stack snapshot --ref` and asserts `stack diff` exits 0 with the exact top classification
  `removed` — not merely exit 0, since a no-op or wrong revision pair also exits 0 trivially on an
  empty diff. The RED leg is the REVERSE (downgrade) direction of the same pair and asserts exit 2
  with `FAILS CLOSED`.
- **The read-only `stack_diff` MCP tool** (11th tool; [`src/mcp-server.ts`](../src/mcp-server.ts))
  classifies two already-written manifests and returns the structured report — it never writes a
  manifest and never blocks the caller; `classification` / `approvalBlocked` /
  `downgradeAckRequired` are legible in the result.

## What is not built yet

`stack reconcile` (a forward-only proposal to bring a blueprint's stack block in sync with the
latest closure), any blueprint constraint type over a stack, yarn lockfiles, pnpm lockfiles other
than v9, and image-tag resolution. Registry resolution never happens inside `gate`/`run`.
