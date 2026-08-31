# First win — TypeScript

**Starting shape:** a small TypeScript service with a data-access seam and one handler.

**The rule we are going to enforce:** SQL is parameterized. No query text is built by
interpolating a value into a template literal — the driver escapes values, the caller never
does.

**What this shape proves:** a constraint does not have to be about dependencies. This
walkthrough authors a `forbiddenPattern` — a content rule over the scanned surface — so the
matrix demonstrates two different constraint kinds, not one kind four times.

It also differs from [`examples/quickstart`](../../quickstart/README.md) in a way that matters:
quickstart hands you a **pre-authored, ratified** blueprint and shows you the gate. Here you
author the contract yourself with `bce author`, from flags, and gate what you just wrote.

## 0. Work in a copy

```bash
cp -R examples/first-win/typescript/repo /tmp/bce-first-win-typescript
cd /tmp/bce-first-win-typescript
mkdir -p .blueprints
```

`bce` below is the engine's CLI. From a checkout of this repository, substitute
`node /path/to/bce/dist/cli.js` after `npm ci && npm run build` — see
[`../README.md`](../README.md) for the checkout-vs-package distinction.

The starting tree:

```
/tmp/bce-first-win-typescript/
├── package.json
└── src/
    ├── db.ts                  # the parameterized-query seam → conformant
    └── handlers/orders.ts     # interpolates a value into SQL → the seeded violation
```

## 1. Author the blueprint

```bash
bce author \
  --id parameterized-queries-only \
  --intent-ref policy/no-string-built-sql \
  --constraint 'forbiddenPattern:SELECT .*\$\{:critical' \
  --extraction-profile plugin-surface \
  --scope-paths "src/**/*.ts" \
  --min-files 1 \
  --repo . \
  --out .blueprints/parameterized-queries-only.blueprint.json
```

```
authored DRAFT blueprint parameterized-queries-only@0.1.0 -> .blueprints/parameterized-queries-only.blueprint.json (1 constraint(s), 1 intent ref(s)) — schema-VALID, round-tripped
author sanity: scope matches 2 file(s) in . (0 component(s) observed)
```

Exit code **0**. Note the single quotes around the constraint: the pattern contains `$` and `{`,
which the shell would otherwise try to expand. The pattern itself is compiled through the
engine's safe-pattern guard at authoring time — a non-compiling or catastrophically-backtracking
regex is refused here, with a legible message, rather than at gate time.

## 2. Gate it — RED

```bash
bce gate --repo . --extractor ast --all
```

```
::error::blueprint parameterized-queries-only@0.1.0 FAILED — score 60: 1 NEW violation(s). 1 constraint(s) evaluated; 1 violation(s); score 60
::error::  forbidden-pattern-select (critical): 1 violation(s)
::error::    - [forbidden-pattern-select/critical] file:src/handlers/orders.ts
        observed: forbidden content pattern /SELECT .*\$\{/ matched at src/handlers/orders.ts#L12
        expected: no match of /SELECT .*\$\{/ in the scanned surface
        at:       src/handlers/orders.ts#L12
      fix: change the code to satisfy 'forbidden-pattern-select'  |  amend: if the rule is wrong, edit/remove 'forbidden-pattern-select' in the blueprint via PR
```

Exit code **1**. The `observed` line quotes the pattern that matched and the line it matched on —
a content violation reports the same way a dependency violation does.

## 3. Fix it — GREEN

One line in `src/handlers/orders.ts`. Replace the interpolated query:

```ts
return pool.query(`SELECT * FROM orders WHERE customer_id = '${customerId}' ORDER BY placed_at DESC`);
```

with the parameterized form:

```ts
return pool.query('SELECT * FROM orders WHERE customer_id = $1 ORDER BY placed_at DESC', [customerId]);
```

```bash
bce gate --repo . --extractor ast
```

```
  ✓ parameterized-queries-only@0.1.0 — score 100 (pass)
bce gate [enforced]: 1/1 blueprint(s) evaluated, 0 failing.
```

Exit code **0**.

## What this shape proves

The contract you enforce is the one you wrote, from flags, in one command — and it can be a
content rule as easily as a dependency rule. A `forbiddenPattern` is the right tool when the
thing you want to ban is a *shape of code* rather than an edge in the dependency graph.

---

Back to [the first-win matrix](../README.md) · the timing proof for this walkthrough lives in
[`tests/first-win-matrix.test.ts`](../../../tests/first-win-matrix.test.ts).
