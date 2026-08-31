# First win — monorepo

**Starting shape:** a two-package workspace. `packages/api` runs on the server;
`packages/web` ships to the browser.

**The rule we are going to enforce:** the payment SDK is server-only. `packages/api` may import
it — that is what the server package is *for*. `packages/web` may not: the browser bundle must
never carry the SDK or the secret key it is constructed with.

**What this shape proves:** the same module can be conformant in one package and a violation in
another. `--scope-paths` is what makes that expressible, and it is the flag that matters most
once your target is not the repository root.

## 0. Work in a copy

```bash
cp -R examples/first-win/monorepo/repo /tmp/bce-first-win-monorepo
cd /tmp/bce-first-win-monorepo
mkdir -p .blueprints
```

`bce` below is the engine's CLI. From a checkout of this repository, substitute
`node /path/to/bce/dist/cli.js` after `npm ci && npm run build` — see
[`../README.md`](../README.md) for the checkout-vs-package distinction.

The starting tree — **both** packages import the payment SDK:

```
/tmp/bce-first-win-monorepo/
├── package.json
└── packages/
    ├── api/src/billing.service.ts   # imports the SDK → CONFORMANT (server-side, out of scope)
    └── web/src/checkout.page.ts     # imports the SDK → the seeded violation
```

## 1. Author the blueprint — narrowed to the web package

The whole rule lives in one flag: `--scope-paths "packages/web/src/**/*.ts"`.

```bash
bce author \
  --id payment-sdk-is-server-only \
  --intent-ref policy/payment-sdk-server-only \
  --constraint "forbiddenDependency:stripe:critical" \
  --extraction-profile plugin-surface \
  --scope-paths "packages/web/src/**/*.ts" \
  --min-files 1 \
  --repo . \
  --out .blueprints/payment-sdk-is-server-only.blueprint.json
```

```
authored DRAFT blueprint payment-sdk-is-server-only@0.1.0 -> .blueprints/payment-sdk-is-server-only.blueprint.json (1 constraint(s), 1 intent ref(s)) — schema-VALID, round-tripped
author sanity: scope matches 1 file(s) in . (0 component(s) observed)
```

Exit code **0**. Read `scope matches 1 file(s)` closely — the workspace holds two source files,
and the scan deliberately resolves **one**. The api package is outside the scope, so it is not
scanned at all. That is the narrowing working, visible before you ever run the gate.

## 2. Gate it — RED, and only the web package is named

```bash
bce gate --repo . --extractor ast --all
```

```
::error::blueprint payment-sdk-is-server-only@0.1.0 FAILED — score 60: 1 NEW violation(s). 1 constraint(s) evaluated; 1 violation(s); score 60
::error::  forbidden-dependency-stripe (critical): 1 violation(s)
::error::    - [forbidden-dependency-stripe/critical] file:packages/web/src/checkout.page.ts
        observed: forbidden edge file:packages/web/src/checkout.page.ts -> stripe is present
        expected: no stripe edge
        at:       packages/web/src/checkout.page.ts#L8
      fix: change the code to satisfy 'forbidden-dependency-stripe'  |  amend: if the rule is wrong, edit/remove 'forbidden-dependency-stripe' in the blueprint via PR
```

Exit code **1**. One violation, in `packages/web`. `packages/api/src/billing.service.ts` imports
the very same module on its own line 10 and is **not** reported — because the contract says the
server is allowed to. A gate that flagged both would be telling you to break your own
architecture.

## 3. Fix it — GREEN

The browser stops calling the SDK and posts to the api package's route instead. In
`packages/web/src/checkout.page.ts`, delete the `import Stripe from 'stripe';` line and the
`client` it constructs, and call the route:

```ts
export async function startCheckout(cartId: string, amountCents: number) {
  const res = await fetch('/api/checkout/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cartId, amountCents }),
  });
  const session = (await res.json()) as { url: string };
  window.location.assign(session.url);
}
```

```bash
bce gate --repo . --extractor ast
```

```
  ✓ payment-sdk-is-server-only@0.1.0 — score 100 (pass)
bce gate [enforced]: 1/1 blueprint(s) evaluated, 0 failing.
```

Exit code **0** — with `packages/api/src/billing.service.ts` untouched, still importing the SDK,
still conformant.

## What this shape proves

Architectural rules in a workspace are usually *directional*: this layer may, that layer may
not. `--scope-paths` is how you say which. The gate then enforces the boundary you actually
drew, instead of a repo-wide ban that would force the server to work around its own contract.

---

Back to [the first-win matrix](../README.md) · the timing proof for this walkthrough lives in
[`tests/first-win-matrix.test.ts`](../../../tests/first-win-matrix.test.ts).
