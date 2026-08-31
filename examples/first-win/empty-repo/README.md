# First win — empty repo

**Starting shape:** a brand-new service. A `package.json` and nothing else — no `src/`, no
source files at all.

**The rule we are going to enforce:** HTTP calls go through the platform's built-in `fetch`,
never the legacy `node-fetch` shim. One HTTP client, not two.

**What is honest about this shape:** an empty repository cannot be gated, and bce says so
rather than pretending. The first thing that happens here is a **refusal** — and that refusal
*is* the first win, because it arrives in seconds and tells you exactly what to fix. A tool
that cheerfully scores an empty tree 100 is worse than useless; this one exits 2 and explains
itself.

## 0. Work in a copy

Every command below runs from a scratch copy, so the walkthrough never dirties this
repository (and so you can point it at your own repo instead):

```bash
cp -R examples/first-win/empty-repo/repo /tmp/bce-first-win-empty-repo
cd /tmp/bce-first-win-empty-repo
mkdir -p .blueprints
```

`bce` below is the engine's CLI. From a checkout of this repository, substitute
`node /path/to/bce/dist/cli.js` after `npm ci && npm run build` — see
[`../README.md`](../README.md) for the checkout-vs-package distinction.

## 1. Author a blueprint — and watch it refuse

```bash
bce author \
  --id fetch-through-the-platform \
  --intent-ref policy/one-http-client \
  --constraint "forbiddenDependency:node-fetch:critical" \
  --extraction-profile plugin-surface \
  --scope-paths "src/**/*.js" \
  --min-files 1 \
  --repo . \
  --out .blueprints/fetch-through-the-platform.blueprint.json
```

```
authored DRAFT blueprint fetch-through-the-platform@0.1.0 -> .blueprints/fetch-through-the-platform.blueprint.json (1 constraint(s), 1 intent ref(s)) — schema-VALID, round-tripped
::error::author sanity FAILED: the blueprint scope matched 0 files in . (profile 'plugin-surface', paths: src/**/*.js). A blueprint whose scope resolves nothing gates nothing — fix --scope-paths (draft left at .blueprints/fetch-through-the-platform.blueprint.json for editing).
```

Exit code **2**. Read the two lines carefully — they say different things, and both are true:

- The blueprint itself is **fine**: it parsed, it self-validated against the strict schema, and
  it round-tripped through the parser. The draft is on disk, ready to edit.
- The blueprint currently **gates nothing**, because its scope (`src/**/*.js`) matches zero
  files in this repo. bce refuses to let that pass as a success.

This is the fail-closed posture the whole engine is built on: an empty or partial scan is a
hard failure, never a silent 100. The draft is deliberately left on disk so you can fix the
scope, or — as here — fix the repo.

## 2. Write the first source file, then re-author

Create `src/health.check.js`:

```js
'use strict';
const fetch = require('node-fetch');

async function checkUpstream(url) {
  const res = await fetch(url, { method: 'HEAD' });
  return { ok: res.ok, status: res.status };
}

module.exports = { checkUpstream };
```

Re-run the exact same `bce author` command from step 1. This time the sanity check has
something to look at:

```
authored DRAFT blueprint fetch-through-the-platform@0.1.0 -> .blueprints/fetch-through-the-platform.blueprint.json (1 constraint(s), 1 intent ref(s)) — schema-VALID, round-tripped
author sanity: scope matches 1 file(s) in . (0 component(s) observed)
```

Exit code **0**. `0 component(s) observed` is not a problem: this profile only names a
*component* when it recognises an exported factory. A plain module still gets scanned for
forbidden imports, which is what this contract is about — as the next step proves.

## 3. Gate it — RED

```bash
bce gate --repo . --extractor ast --all
```

```
::error::blueprint fetch-through-the-platform@0.1.0 FAILED — score 60: 1 NEW violation(s). 1 constraint(s) evaluated; 1 violation(s); score 60
::error::  forbidden-dependency-node-fetch (critical): 1 violation(s)
::error::    - [forbidden-dependency-node-fetch/critical] file:src/health.check.js
        observed: forbidden edge file:src/health.check.js -> node-fetch is present
        expected: no node-fetch edge
        at:       src/health.check.js#L2
      fix: change the code to satisfy 'forbidden-dependency-node-fetch'  |  amend: if the rule is wrong, edit/remove 'forbidden-dependency-node-fetch' in the blueprint via PR
```

Exit code **1** — a real gate failure, the kind that blocks a merge. Note it named the file and
the line (`src/health.check.js#L2`), and it offered both ways out: fix the code, or amend the
contract through a reviewed PR.

## 4. Fix it — GREEN

The fix is one line: **delete** `const fetch = require('node-fetch');`. Node 18+ provides a
global `fetch`, so the call in the body keeps working untouched.

```bash
bce gate --repo . --extractor ast
```

```
  ✓ fetch-through-the-platform@0.1.0 — score 100 (pass)
bce gate [enforced]: 1/1 blueprint(s) evaluated, 0 failing.
```

Exit code **0**. Refusal → first file → RED → one-line fix → GREEN.

## What this shape proves

An empty repository is the one starting point where the honest answer is "not yet." bce gives
you that answer in seconds, with the reason and the remedy, instead of a green check that means
nothing. Everything after that is the ordinary loop.

---

Back to [the first-win matrix](../README.md) · the timing proof for this walkthrough lives in
[`tests/first-win-matrix.test.ts`](../../../tests/first-win-matrix.test.ts).
