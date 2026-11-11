# First win — direct module layering

**Starting shape:** application and domain packages in one TypeScript workspace.

**The rule:** application code may use domain code; domain code must never import the application
layer. The starting tree contains one reverse import in `packages/domain/order.ts`.

**Availability:** this walkthrough uses `typescript-module-graph` from the `v0.6.4` release.

## 0. Work in a copy

Run this from the project where you installed the engine (`npm install --save-dev --save-exact
bce-engine@0.6.4`, see [`../README.md`](../README.md)). It copies the shipped starting tree into a
subdirectory of that project and works the same in bash, zsh, PowerShell and cmd:

```bash
node -e "const fs=require('node:fs');fs.cpSync('node_modules/bce-engine/examples/first-win/module-layering/repo','first-win-module-layering',{recursive:true});fs.mkdirSync('first-win-module-layering/.blueprints',{recursive:true})"
cd first-win-module-layering
```

`bce` below means `npx --no-install bce`, run from inside `first-win-module-layering`. The copy has its own
`package.json` with no dependencies, so it must stay inside the project: npx finds the CLI in the
parent's `node_modules/.bin`. A copy somewhere else (for example `/tmp`) cannot resolve it. If
npx still cannot find it, `node ../node_modules/bce-engine/dist/cli.js` runs the same CLI. Do not
drop `--no-install`: an unrelated package named `bce` is on the npm registry, and npx would offer
to install it.

**From a checkout of this repository instead:** after `npm ci && npm run build`, copy
`examples/first-win/module-layering/repo` to any scratch directory, create `.blueprints/` in it, and use
`node /path/to/bce/dist/cli.js` wherever a step says `bce`.

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
upgrade diagnosis instead of misreading newer vocabulary.

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
