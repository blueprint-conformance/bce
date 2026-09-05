# First win — direct module layering

**Starting shape:** application and domain packages in one TypeScript workspace.

**The rule:** application code may use domain code; domain code must never import the application
layer. The starting tree contains one reverse import in `packages/domain/order.ts`.

**Availability:** this walkthrough uses `typescript-module-graph` from the unpublished `v0.3.0`
source candidate. Run it with a built source checkout; `bce-engine@0.2.0` cannot parse this profile.

## 0. Work in a copy

```bash
cp -R examples/first-win/module-layering/repo /tmp/bce-first-win-module-layering
cd /tmp/bce-first-win-module-layering
mkdir -p .blueprints
```

`bce` below means `node /path/to/bce/dist/cli.js` from a built candidate checkout.

## 1. Author one directional boundary

Only domain importers are governed. Application modules remain free to import domain modules.

```bash
bce author \
  --id domain-does-not-import-app \
  --intent-ref policy/domain-below-application \
  --constraint "requiredComponent:typescriptModule:critical" \
  --constraint "forbiddenDependency:module:packages/app/**:critical" \
  --extraction-profile typescript-module-graph \
  --scope-paths "packages/domain/**/*.ts" \
  --min-files 1 \
  --repo . \
  --out .blueprints/domain-does-not-import-app.blueprint.json
```

```console
authored DRAFT blueprint domain-does-not-import-app@0.1.0 -> .blueprints/domain-does-not-import-app.blueprint.json (2 constraint(s), 1 intent ref(s)) — schema-VALID, round-tripped
author sanity: scope matches 1 file(s) in . (1 component(s) observed)
```

The generated draft carries `minEngineVersion: "0.3.0"`, so an older pinned gate produces an
upgrade diagnosis instead of misreading the candidate vocabulary.

## 2. Gate it — RED at the reverse edge

```bash
bce gate --repo . --extractor ast --all
```

```console
::error::blueprint domain-does-not-import-app@0.1.0 FAILED — score 60: 1 NEW violation(s). 2 constraint(s) evaluated; 1 violation(s); score 60
::error::  forbidden-dependency-module-packages-app (critical): 1 violation(s)
::error::    - [forbidden-dependency-module-packages-app/critical] module:packages/domain/order.ts
        observed: forbidden direct import module:packages/domain/order.ts -> module:packages/app/view.ts is present
        expected: no direct imports edge from packages/domain/**/*.ts to module:packages/app/**
        at:       packages/domain/order.ts#L1
```

## 3. Fix the dependency direction — GREEN

Remove the import from `packages/domain/order.ts`; pricing remains a domain calculation:

```ts
export interface Order {
  total: number;
}

export function priceOrder(order: Order): number {
  return order.total;
}
```

```bash
bce gate --repo . --extractor ast
```

```console
  ✓ domain-does-not-import-app@0.1.0 — score 100 (pass)
bce gate [enforced]: 1/1 blueprint(s) evaluated, 0 failing.
```

The unrelated `packages/app/view.ts` module does not import domain and remains conformant. This
matters: the portable rule is the forbidden reverse edge, not “every application file must import
domain.”

---

Back to [the first-win matrix](../README.md) · exact selector and uncertainty semantics live in the
[module-graph guide](../../../docs/typescript-module-graph.md).
