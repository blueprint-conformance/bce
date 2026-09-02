# First win — pick the shape closest to your repository

[`quickstart.md`](quickstart.md) is the five-minute guaranteed path on a fixed two-tree example.
This page is the next question: **what does that loop look like on a repository shaped like
mine?**

The answer is four worked walkthroughs under
[`examples/first-win/`](../examples/first-win/README.md), one per starting shape. Each authors its
own contract with `bce author`, gates it to a real RED, fixes the code, and gates it to GREEN.
All four are executed and **timed** in CI by
[`tests/first-win-matrix.test.ts`](../tests/first-win-matrix.test.ts), which fails if any shape's
full sequence exceeds 120 seconds.

## Pick your shape

| If your repository is… | Start here | The distinct thing it teaches |
|---|---|---|
| brand new — no source files yet | [empty-repo](../examples/first-win/empty-repo/README.md) | The refusal. An empty scope exits **2** with the reason, rather than scoring an empty tree 100. |
| plain JavaScript — `require`, no build step | [plain-js](../examples/first-win/plain-js/README.md) | A CommonJS `require()` in a `.js` file is real AST evidence. No `tsconfig` needed. |
| a TypeScript service | [typescript](../examples/first-win/typescript/README.md) | Authoring a **content** rule (`forbiddenPattern`) rather than a dependency edge. |
| a workspace with several packages | [monorepo](../examples/first-win/monorepo/README.md) | `--scope-paths`, so the same import can be allowed in one package and forbidden in another. |

If none of them matches exactly, start with the one whose *language* matches and change the
`--scope-paths` glob — that flag is what adapts a walkthrough to a different layout.

## The loop, in one line

```
bce author …   →   bce gate  (RED, exit 1)   →   edit the code   →   bce gate  (GREEN, exit 0)
```

`bce author` (aliased `bce init`) is flag-driven and interactive-free, so it scripts cleanly and
behaves identically whether a human or an agent runs it. It writes a blueprint that is
`status: draft` at version `0.1.0` and self-validates against the strict schema before writing —
authoring is deliberately not ratification. Promoting a draft to `approved` is a human review
step.

## How big is the fix?

The matrix reports this honestly rather than rounding every shape to "one line":

| Shape | The fix |
|---|---|
| empty-repo | one line — delete the `require` (Node 18+ has a global `fetch`) |
| plain-js | two lines — delete the `require`, swap the formatting call |
| typescript | one line — replace the interpolated query with a parameterized one |
| monorepo | a small edit — drop the import and the client, call the server route instead |

## Run from the published package

The walkthroughs are written with `bce` as the command. Install the exact release and copy the
shipped examples to a writable directory:

```bash
npm install --save-dev --save-exact bce-engine@0.1.5
cp -R node_modules/bce-engine/examples/first-win ./bce-first-win
npx --no-install bce …
```

The published package includes `examples/` and the complete onboarding assets. Registry signatures,
provenance, a clean-room install, and the black-box consumer proof verify the package path. See
[`self-hosting.md`](self-hosting.md) for how Lane A uses the same exact artifact independently.

Both of those statements are asserted against the repository's own state by the matrix test, so a
publish cannot silently leave this page stale.

## Recommended next step

- [`adopt-existing-repo.md`](adopt-existing-repo.md) — turn the gate on a repository that already
  drifts, without a day-one wall of red.
