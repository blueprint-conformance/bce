# The authoring matrix — five layouts, five measured RED→GREEN loops

The [First Win recipe catalog](../../docs/first-win.md) proves six architecture boundaries in the
`v0.3.0` source candidate. This directory answers the next question: **how do I author one of those
contracts against files laid out like mine?**

Five starting layouts. Each one authors its own contract with `bce author`, gates it to a real
RED, fixes it, and gates it to GREEN. Every step is executed in CI by
[`tests/first-win-matrix.test.ts`](../../tests/first-win-matrix.test.ts), which also **measures
the wall-clock of each full sequence and fails if any shape exceeds 120 seconds**. The timings
in the table below are not estimates.

| Shape | Starting point | Contract authored | What it proves |
|---|---|---|---|
| [empty-repo](empty-repo/README.md) | `package.json`, no source at all | `forbiddenDependency:node-fetch` | The honest refusal: an empty scope **exits 2** and says why, instead of scoring 100 |
| [plain-js](plain-js/README.md) | CommonJS, no TypeScript, no build | `forbiddenDependency:moment` | A `require()` in a `.js` file is real AST evidence — JS is a first-class target |
| [typescript](typescript/README.md) | TypeScript service, one handler | `forbiddenPattern` (interpolated SQL) | A contract can be a *content* rule, not only a dependency edge — and you author it yourself |
| [monorepo](monorepo/README.md) | Two packages, server + browser | `forbiddenDependency:stripe`, scoped | `--scope-paths`: the same import is conformant in one package and a violation in another |
| [module-layering](module-layering/README.md) | Application + domain packages | module-targeted `forbiddenDependency` | A reverse direct import is located and blocked; `minEngineVersion` is automatic |

Every shape follows the same loop:

```
bce author …   →   bce gate  (RED, exit 1)   →   edit the code   →   bce gate  (GREEN, exit 0)
```

## Which command is `bce`?

Install the exact public package and copy its shipped examples to a writable directory:

```bash
npm view bce-engine@0.2.0 version dist.integrity
npm install --save-dev --save-exact bce-engine@0.2.0
cp -R node_modules/bce-engine/examples/first-win ./bce-first-win
# then, wherever a walkthrough says `bce`:
npx --no-install bce …
```

The published package manifest includes `examples/`: four `v0.2.0` walkthroughs plus the full
onboarding assets. The
module-layering walkthrough is candidate-only and must run from a built checkout until `v0.3.0`
resolves on npm. Registry signatures and provenance verify only the released package path; the
candidate has a separate clean-room local-tarball proof.

Both statements are checked against the repository's own state by the matrix test, so they cannot
quietly go stale after a publish.

## Running the whole matrix yourself

```bash
npm ci && npm run build
npx vitest run tests/first-win-matrix.test.ts
```

The test prints the measured duration of each shape's full sequence. It copies every fixture to a
temporary directory first, so running it never modifies this tree.

## What "first win" means here

Not "the tool installed successfully." A first win is a gate you authored, watched fail on your
own code for a reason you agree with, fixed, and watched pass — because until you have seen it go
red, a green check is just a green check.

---

Next: [`docs/first-win.md`](../../docs/first-win.md) helps you pick the architecture boundary first ·
[`docs/adopt-existing-repo.md`](../../docs/adopt-existing-repo.md) is the brownfield path for a
codebase that already drifts.
