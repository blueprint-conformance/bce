# bce quickstart — a real RED, then GREEN, in five minutes offline

This is the guaranteed path. It runs entirely offline (no API keys, no network beyond the
one `npm install`), on a tiny two-tree example that ships in this directory, and it ends in a
real gate failure you fix and re-run to green. If you only do one thing with bce, do this.

You will:

1. install the engine,
2. gate a **clean** tree — it passes (score 100),
3. gate a **drifted** tree — it fails, and the gate names the exact violating line,
4. fix the drift and re-gate — it passes.

A gate that cannot go red is not a gate. This walkthrough proves, on your own machine, that
this one can — and that a green verdict means something.

## The example

One contract, two trees that differ by a single line:

```
examples/quickstart/
├── blueprint/
│   └── no-direct-http-client.blueprint.json   # the contract: no plugin imports an HTTP client directly
├── clean/
│   └── src/greeting.plugin.ts                 # routes network through the governed host  → PASS
└── drift/
    └── src/greeting.plugin.ts                 # adds `import axios from 'axios'`           → RED
```

The contract is an ordinary architectural rule: **a plugin sends network traffic through the
governed host — never a directly-imported HTTP client.** Routing egress through the host is
what gives you one place for auth, budget, and logging; a plugin that reaches for `axios`
itself quietly bypasses all three. The blueprint makes that rule enforceable.

## 0. Install the exact release and copy the writable example

```bash
mkdir bce-quickstart && cd bce-quickstart
npm init -y
npm install --save-dev --save-exact bce-engine@0.1.3
cp -R node_modules/bce-engine/examples/quickstart .
cd quickstart
alias bce='../node_modules/.bin/bce'
```

Every command below runs in the copied `quickstart` directory through the exact public engine pin.

## 1. The blueprint is valid — and the engine says how far its vacuity probe can trust it

First, confirm the contract parses:

```bash
bce validate --blueprint blueprint/no-direct-http-client.blueprint.json
```

```
blueprint VALID: no-direct-http-client@0.1.0 (1 constraint(s))
```

Then ask the engine how much its own vacuity probe can prove about this contract. This is the
`teeth` gate, and its verdict is deliberately three-way — `toothed` / `evaluator-refutable` /
`toothless` — because the probe itself has an honesty boundary:

```bash
bce teeth --blueprint blueprint/no-direct-http-client.blueprint.json --ct-repo clean --no-pin --extractor ast
```

```
TeethReport: no-direct-http-client@0.1.0 -> evaluator-refutable — EVALUATOR-REFUTABLE: 0/1 constraint(s) have extractor-real teeth; 1 refutable by the evaluator alone (synthetic-evidence mutations — NOT evidence of real teeth; substance proof = a mutation corpus); 0 trivially-green, 0 indeterminate
```

Read that honestly, because it is the engine being honest about *itself*. The teeth probe
works by injecting a synthetic violation and checking the evaluator fires. For a dependency
constraint like this one, that synthetic flip proves the *evaluator* would fail the edge —
it does **not** prove the *extractor* would ever produce that edge from real source. So the
verdict is `evaluator-refutable` (exit 0), not `toothed`: a weaker, truthful claim. `toothless`
(exit 2) — no mutation the probe knows can redden the contract at all — is the verdict that
should stop you. And never gate on the verdict *string*: the probe is an annotation, not the
enforcement.

The substance proof — real bad *source* turning the gate red end-to-end — is exactly what
step 3 below is. This walkthrough's `drift/` tree **is** the one-fixture mutation corpus the
report points at: you are about to watch the extractor find a real forbidden import in real
code and the gate refuse it.

## 2. Gate the clean tree — it passes

```bash
bce gate --repo clean --blueprint-dir blueprint --extractor ast
```

```
  ✓ no-direct-http-client@0.1.0 — score 100 (pass)
bce gate [enforced]: 1/1 blueprint(s) evaluated, 0 failing.
```

Exit code `0`. The clean plugin routes its network call through `host.fetch(...)`, so there is
no forbidden import edge — the gate is green.

## 3. Gate the drifted tree — it fails, and names the line

```bash
bce gate --repo drift --blueprint-dir blueprint --extractor ast --all
```

```
::error::blueprint no-direct-http-client@0.1.0 FAILED — score 60: 1 NEW violation(s). 1 constraint(s) evaluated; 1 violation(s); score 60
::error::  no-direct-http-client (critical): 1 violation(s)
::error::    - [no-direct-http-client/critical] extension:greeting.plugin
        observed: forbidden edge extension:greeting.plugin -> axios is present
        expected: no axios edge
        at:       src/greeting.plugin.ts#L16
      fix: change the code to satisfy 'no-direct-http-client'  |  amend: if the rule is wrong, edit/remove 'no-direct-http-client' in the blueprint via PR
bce gate [enforced]: 1/1 blueprint(s) evaluated, 1 failing.
```

Exit code `1` — this is a real gate failure, the kind that would block a merge in CI. The
drifted plugin is one line different from the clean one: it adds
`import axios from 'axios'` and calls the network directly. The gate reports:

- **which** rule failed (`no-direct-http-client`, `critical`),
- **what** it saw versus what it required (`observed` / `expected`),
- **where** (`src/greeting.plugin.ts#L16`, the forbidden import),
- and **both** ways out — fix the code, or, if the rule itself is wrong, amend the blueprint
  through a reviewed PR. The gate never edits your code or your contract for you.

## 4. Fix it — and go green

Open `drift/src/greeting.plugin.ts`. The drift is two lines: the `axios` import near the top,
and the `axios.get(...)` call in the body. Route the call back through the host, exactly like
the clean tree does:

- **delete** the line `import axios from 'axios';`
- **replace** the body line
  `const res = await axios.get('https://example.com/greeting');`
  with
  `const res = await host.fetch('/greeting');`

(That is precisely the difference between `drift/src/greeting.plugin.ts` and
`clean/src/greeting.plugin.ts` — you can diff the two to see it.)

Now re-run the gate on the tree you just fixed:

```bash
bce gate --repo drift --blueprint-dir blueprint --extractor ast
```

```
  ✓ no-direct-http-client@0.1.0 — score 100 (pass)
bce gate [enforced]: 1/1 blueprint(s) evaluated, 0 failing.
```

Exit code `0`. The forbidden edge is gone, so the gate is green again — RED → fix → GREEN,
end to end, offline.

## What just happened

- A **blueprint** is a small, versioned JSON file that states an architectural rule as an
  enforceable contract. The one here forbids a direct HTTP-client dependency.
- `bce gate` reads the blueprints for a repository, measures the code against them, prints a
  numeric score and a fail-closed verdict, and exits non-zero on any failure — so it drops
  straight into CI as a required check.
- The verdict is honest by construction: an empty scan or a malformed blueprint is a hard
  failure, not a silent pass, and `bce teeth` refuses to let a vacuous contract masquerade as
  a passing one. There is no `--skip` flag — adoption on an already-drifting codebase is
  handled by committed, reviewed configuration (advisory mode, `bce baseline`), never by an
  invisible CI-line override.

## Where to go next

- **Gate your own repository.** Put one or more `*.blueprint.json` files in a `.blueprints/`
  directory at your repo root and run `bce gate --repo . --extractor ast`. Author a starter
  blueprint interactively-free with `bce author` (it self-validates and refuses a scope that
  matches no files).
- **Have an agent draft the first blueprint for you** (experimental): see
  [`../../prompts/blueprint-author.md`](../../prompts/blueprint-author.md). It drives a coding
  agent to propose a blueprint from an existing repository, always ending in `bce teeth` and a
  human PR review — the engine never writes your contract unattended.
- **Understand the adoption levers** — advisory mode and shrink-only baselines — in
  [`../../docs/faq.md`](../../docs/faq.md).
