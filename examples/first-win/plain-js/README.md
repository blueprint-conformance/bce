# First win — plain JavaScript

**Starting shape:** a small CommonJS project. No TypeScript, no build step, no bundler —
`require`, `module.exports`, two files.

**The rule we are going to enforce:** dates are formatted with the built-in `Intl` API, not
with `moment`. The library is in maintenance mode and ships a large locale bundle; the platform
already has a date formatter.

**What this shape proves:** the extractor is a real TypeScript/JavaScript AST, not a
TypeScript-only path. A CommonJS `require('moment')` in a `.js` file is found, named, and
located — same as an ESM `import` in a `.ts` file.

## 0. Work in a copy

```bash
cp -R examples/first-win/plain-js/repo /tmp/bce-first-win-plain-js
cd /tmp/bce-first-win-plain-js
mkdir -p .blueprints
```

`bce` below is the engine's CLI. From a checkout of this repository, substitute
`node /path/to/bce/dist/cli.js` after `npm ci && npm run build` — see
[`../README.md`](../README.md) for the checkout-vs-package distinction.

The starting tree:

```
/tmp/bce-first-win-plain-js/
├── package.json
└── src/
    ├── invoice.report.js   # requires moment  → the seeded violation
    └── money.js            # pure arithmetic  → conformant
```

## 1. Author the blueprint

```bash
bce author \
  --id dates-through-intl \
  --intent-ref policy/no-legacy-date-library \
  --constraint "forbiddenDependency:moment:critical" \
  --extraction-profile plugin-surface \
  --scope-paths "src/**/*.js" \
  --min-files 1 \
  --repo . \
  --out .blueprints/dates-through-intl.blueprint.json
```

```
authored DRAFT blueprint dates-through-intl@0.1.0 -> .blueprints/dates-through-intl.blueprint.json (1 constraint(s), 1 intent ref(s)) — schema-VALID, round-tripped
author sanity: scope matches 2 file(s) in . (0 component(s) observed)
```

Exit code **0**. The blueprint is born `status: draft` at version `0.1.0` — authoring is not
ratification. Promoting a draft to `approved` is a human review step, never something this
command does for you.

## 2. Gate it — RED

```bash
bce gate --repo . --extractor ast --all
```

```
::error::blueprint dates-through-intl@0.1.0 FAILED — score 60: 1 NEW violation(s). 1 constraint(s) evaluated; 1 violation(s); score 60
::error::  forbidden-dependency-moment (critical): 1 violation(s)
::error::    - [forbidden-dependency-moment/critical] file:src/invoice.report.js
        observed: forbidden edge file:src/invoice.report.js -> moment is present
        expected: no moment edge
        at:       src/invoice.report.js#L10
      fix: change the code to satisfy 'forbidden-dependency-moment'  |  amend: if the rule is wrong, edit/remove 'forbidden-dependency-moment' in the blueprint via PR
```

Exit code **1**. Two files were scanned; the one that requires `moment` is named, at the exact
line of the `require`. `src/money.js` is conformant and is not mentioned — the report names
violations, not files.

## 3. Fix it — GREEN

Two lines in `src/invoice.report.js`:

- **delete** `const moment = require('moment');`
- **replace** `const issued = moment(invoice.issuedAt).format('YYYY-MM-DD');`
  with `const issued = new Intl.DateTimeFormat('en-CA').format(invoice.issuedAt);`

```bash
bce gate --repo . --extractor ast
```

```
  ✓ dates-through-intl@0.1.0 — score 100 (pass)
bce gate [enforced]: 1/1 blueprint(s) evaluated, 0 failing.
```

Exit code **0**.

## What this shape proves

Plain JavaScript is a first-class target. The `require(...)` form, the ESM `import` form,
re-exports, dynamic `import()` and `import x = require(...)` are all import evidence to the
extractor — so a JS-only codebase gets the same gate a TypeScript one does, with no `tsconfig`
and no build step.

---

Back to [the first-win matrix](../README.md) · the timing proof for this walkthrough lives in
[`tests/first-win-matrix.test.ts`](../../../tests/first-win-matrix.test.ts).
