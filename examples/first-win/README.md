# The first-win matrix — four starting shapes, four measured RED→GREEN loops

[`examples/quickstart`](../quickstart/README.md) is the guaranteed path: one fixed example, one
pre-authored contract, five minutes. This directory answers the question that comes next —
**"but what does it look like on a repo shaped like mine?"**

Four starting shapes. Each one authors its own contract with `bce author`, gates it to a real
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

Every shape follows the same loop:

```
bce author …   →   bce gate  (RED, exit 1)   →   edit the code   →   bce gate  (GREEN, exit 0)
```

## Which command is `bce`?

**From a checkout of this repository** — the path these walkthroughs and the CI test both
exercise:

```bash
npm ci && npm run build
# then, wherever a walkthrough says `bce`:
node /path/to/bce/dist/cli.js …
```

**From the published npm package** is not available yet. The registry name currently serves a
non-functional `0.0.0` reservation stub. [`.engine-pin.json`](../../.engine-pin.json) records
`"published": false`, and Lane A remains dormant. Two consequences are worth stating plainly:

 1. **There is no published-package proof yet.** It must be added as a clean-room post-publish
    check before this section can advertise an npm command.
2. **`examples/` is not in the published tarball.** `package.json`'s `files` array ships
   `dist`, `src`, `fixtures`, `integrations` — not `examples`. So even with the package
   published, these fixtures come from a checkout of this repository, not from an installed
   package.

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

Next: [`docs/first-win.md`](../../docs/first-win.md) explains how to pick the shape closest to your
repository · [`docs/adopt-existing-repo.md`](../../docs/adopt-existing-repo.md) is the brownfield
path for a codebase that already drifts.
