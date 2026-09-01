# Witness kit — an independently-run RED → fix → GREEN

A gate that cannot go red is not a gate. Before this project asks anyone to trust a green
verdict, it wants at least one person **the authors do not control** to run the
discriminating pair on **a machine the authors do not control**, and say what they saw.

This page is the script for that. It is the same offline walkthrough as
[`examples/quickstart/README.md`](../../examples/quickstart/README.md), compressed to the
minimum a witness needs. Setup (one install + one build) takes a few minutes; the
RED → fix → GREEN loop itself is under sixty seconds. Everything runs offline — no API
keys, no accounts, no telemetry; the only network use is the one `npm ci`.

## What you need

- **A source copy of this repository** that you obtained yourself — a collaborator clone,
  or a source archive (`git archive` / "Download ZIP"). Use the source tree for a witness run so
  its exact revision and the full witness workflow are independently inspectable.
- **Node 22** (see [`.nvmrc`](../../.nvmrc)) and npm.
- A machine the project's authors have never had access to. Your own laptop is ideal.

Record what you run. `script witness.log` (or asciinema, or plain copy-paste of the
terminal) is enough.

## 0. Note your inputs, then build once

From the repository root:

```bash
node --version            # expect v22.x
git rev-parse HEAD        # (clone only) record the commit
# (archive) there is no .git, so the line above errors — record the checksum instead:
#   sha256sum <archive-file>        # Linux;  macOS: shasum -a 256 <archive-file>
npm ci
npm run build             # produces dist/cli.js, the engine's CLI
cd examples/quickstart
```

Every command below is run from `examples/quickstart/` and uses the CLI you just built —
`node ../../dist/cli.js` — so nothing depends on a published package.

## 1. The clean tree is GREEN

First, confirm the gate is not simply always-red:

```bash
node ../../dist/cli.js gate --repo clean --blueprint-dir blueprint --extractor ast
echo $?
```

Expected:

```
  ✓ no-direct-http-client@0.1.0 — score 100 (pass)
bce gate [enforced]: 1/1 blueprint(s) evaluated, 0 failing.
0
```

## 2. The drifted tree is RED — and the gate names the line

The two trees differ by one thing: `drift/src/greeting.plugin.ts` adds
`import axios from 'axios'` and calls the network directly, instead of routing it through
the governed host. That is exactly what the checked-in contract
(`blueprint/no-direct-http-client.blueprint.json`) forbids.

```bash
node ../../dist/cli.js gate --repo drift --blueprint-dir blueprint --extractor ast --all
echo $?
```

Expected (a real gate failure — the kind that blocks a merge in CI):

```
::error::blueprint no-direct-http-client@0.1.0 FAILED — score 60: 1 NEW violation(s). 1 constraint(s) evaluated; 1 violation(s); score 60
::error::  no-direct-http-client (critical): 1 violation(s)
::error::    - [no-direct-http-client/critical] extension:greeting.plugin
        observed: forbidden edge extension:greeting.plugin -> axios is present
        expected: no axios edge
        at:       src/greeting.plugin.ts#L16
      fix: change the code to satisfy 'no-direct-http-client'  |  amend: if the rule is wrong, edit/remove 'no-direct-http-client' in the blueprint via PR
bce gate [enforced]: 1/1 blueprint(s) evaluated, 1 failing.
1
```

Note the exit code `1`, and that the report names the exact file and line of the forbidden
import.

## 3. Fix it yourself, re-gate — GREEN

Make the fix with your own hands (this is the part that makes you a witness rather than an
audience). The simplest form is one command — the clean tree **is** the fixed tree:

```bash
cp clean/src/greeting.plugin.ts drift/src/greeting.plugin.ts
```

Or edit `drift/src/greeting.plugin.ts` manually: delete the line
`import axios from 'axios';` and replace
`const res = await axios.get('https://example.com/greeting');` with
`const res = await host.fetch('/greeting');`. (Diff the two files to confirm that is the
entire difference.)

Then:

```bash
node ../../dist/cli.js gate --repo drift --blueprint-dir blueprint --extractor ast
echo $?
```

Expected:

```
  ✓ no-direct-http-client@0.1.0 — score 100 (pass)
bce gate [enforced]: 1/1 blueprint(s) evaluated, 0 failing.
0
```

That is the round trip: GREEN on clean, RED on drift with the violating line named, GREEN
again after a change you made yourself.

## Optional: confirm the contract has teeth

Two more commands show the contract parses and is not vacuous (i.e. a realistic code change
could actually redden it — which you just demonstrated in the other direction):

```bash
node ../../dist/cli.js validate --blueprint blueprint/no-direct-http-client.blueprint.json
node ../../dist/cli.js teeth --blueprint blueprint/no-direct-http-client.blueprint.json --ct-repo clean --no-pin --extractor ast
```

Expected: `blueprint VALID: no-direct-http-client@0.1.0 (1 constraint(s))` and a
`TeethReport … -> evaluator-refutable` line (plus a warning spelling out what that verdict
does not claim), both exit `0`.

`evaluator-refutable` is the engine refusing to over-claim: on the green `clean` tree the
teeth probe can flip this constraint's verdict only with synthetic evidence, and it no
longer counts that as proof of real teeth. The extractor-real proof is the one **you**
just produced — the drifted tree going red at `src/greeting.plugin.ts#L16`. (Run the same
`teeth` command with `--ct-repo drift` and it reports `-> toothed` from that already-red
evidence.)

## What you are asked to attest

In your own words, in public or in writing we may quote (a gist, an issue comment, a signed
note — your choice), state:

1. **Independence** — you ran this on a machine the project's authors do not control and
   have never had access to, from a source copy you obtained yourself (name the commit SHA
   or archive checksum).
2. **What you ran** — the commands above, verbatim or with any deviations noted.
3. **What you saw** — the clean tree gated green (exit 0); the drifted tree gated red
   (exit 1) with the violation named at `src/greeting.plugin.ts#L16`; after a fix **you**
   made, the same tree gated green (exit 0).
4. **Environment** — OS and `node --version`.
5. **Any relationship** you have to the authors or the project, so readers can weigh your
   independence for themselves.

Attach or link your terminal recording if you made one.

## What this proves — and what it does not

Worth being precise about, in both directions.

**This run proves:**

- The gate can go red on a machine the authors don't control — the verdict is not
  hard-coded, staged, or environment-dependent theatre.
- The RED and GREEN verdicts discriminate a real, minimal code difference (one forbidden
  import edge), and the failure report names the actual file and line.
- The verdict flips **only** when the code changes, and the witness — not the authors —
  made that change.
- The whole loop runs offline and deterministically: no service, no key, no phone-home.

**This run does not prove:**

- Anything about the engine's behavior on rules or codebases beyond this one small example.
  The engine's broader failure-detection claim is measured separately, against a 34-defect
  corpus with an offline RED/GREEN discriminating pair in CI — that measurement is
  re-runnable from this same checkout, but it is a different experiment from this
  walkthrough.
- That the blueprint model, the score's calibration, or the extractor scale to a large
  real-world repository. The brownfield path
  ([`adopt-existing-repo.md`](../adopt-existing-repo.md)) exists precisely because that is
  harder.
- That the gate cannot be evaded by a sufficiently creative change, or that this project's
  own code is defect-free. A witnessed demonstration is evidence the mechanism is real; it
  is not an audit.

One honest witness run establishes exactly one thing, and it is the thing this project
refuses to ask anyone to take on faith: **the teeth are real.**
