# config-guard — gating a JSON manifest and a policy doc, not code

The [quickstart](../quickstart/README.md) gates TypeScript source. This example shows the other
thing teams actually need on day one: **a governed configuration surface**. The contract here is
"a new workspace ships strictly the `core`, `reports`, and `search` features — widening the
manifest is a reviewed change, never a quiet default" — and the graded files are a JSON manifest
and a Markdown policy record. No code is scanned at all.

It also demonstrates two engine behaviors the quickstart only mentions:

1. the **fail-closed existence floor** (`extraction.minFiles`) — deleting a governing document is a
   conformance failure, not a docs cleanup, and
2. the **honest `evaluator-refutable` teeth verdict** for content-pattern contracts, together with
   the real-source mutation (`drift/`) that is its substance proof.

```
examples/config-guard/
├── blueprint/
│   └── minimal-feature-manifest.blueprint.json   # the contract
├── clean/
│   ├── config/feature-manifest.json              # strictly the day-one trio       → PASS
│   └── docs/FEATURE-POLICY.md                    # the policy record (floor-held)
└── drift/
    ├── config/feature-manifest.json              # + "admin-console"               → RED
    └── docs/FEATURE-POLICY.md
```

All commands are run from **this directory** (`cd examples/config-guard`). `bce` is the installed
CLI, exactly as in the quickstart.

## 1. Validate, then read the teeth verdict honestly

```bash
bce validate --blueprint blueprint/minimal-feature-manifest.blueprint.json
```

```
blueprint VALID: minimal-feature-manifest@0.1.0 (2 constraint(s))
```

```bash
bce teeth --blueprint blueprint/minimal-feature-manifest.blueprint.json --ct-repo clean --no-pin
```

```
TeethReport: minimal-feature-manifest@0.1.0 -> evaluator-refutable — EVALUATOR-REFUTABLE: 0/2 constraint(s) have extractor-real teeth; 2 refutable by the evaluator alone (synthetic-evidence mutations — NOT evidence of real teeth; substance proof = a mutation corpus); 0 trivially-green, 0 indeterminate
```

Both constraints are content patterns, so the vacuity probe can only flip them with synthetic
evidence — the engine says so instead of over-claiming `toothed`. The substance proof is the next
two steps: a real widened manifest goes RED, and a real deleted policy record goes RED. Those two
runs are this example's mutation corpus. (Never gate on the verdict *string*; the probe is an
annotation, the gate is the enforcement.)

## 2. Gate the clean tree — it passes

```bash
bce gate --repo clean --blueprint-dir blueprint
```

```
  ✓ minimal-feature-manifest@0.1.0 — score 100 (pass)
bce gate [enforced]: 1/1 blueprint(s) evaluated, 0 failing.
```

## 3. Gate the drifted tree — one added feature reddens it

`drift/config/feature-manifest.json` differs from clean by exactly one array entry:
`"admin-console"` appended to `enabledFeatures`.

```bash
bce gate --repo drift --blueprint-dir blueprint --all
```

Exit code `1`, and the violation names the file and line. The tooth is the *shape of a JSON array
entry* — a line that is only a bare quoted token — with an allowlist lookahead admitting exactly
the day-one trio and its subtrees. It fires on any bare entry outside the trio **whichever array
it was added to**: a widened feature, an integration, an admin tool, a beta flag.

The second constraint covers the layout the first one structurally cannot see: a *single-line*
widening (`"enabledAdminTools": ["superuser"]`, or the whole `enabledFeatures` array collapsed
onto one line with an extra entry inside), where the key, the bracket and the first entry share
one line. `enabledFeatures` sits in that key set even though it is legitimately non-empty: the
scan matches **per line**, so in the normal pretty-printed layout `[\s*"` can never span the
newline after `[` — the key only fires when the array is *collapsed non-empty onto one line*,
which for this manifest is always a widening-shaped edit. Two patterns, partitioning the widening
space by layout — that is what makes the allowlist hold against real editor output rather than
one formatting convention. (An earlier draft excluded `enabledFeatures` from the inline arm on
the "legitimately non-empty" reasoning; adversarial review proved that exclusion bought nothing
and left the collapsed-array widening green. If you copy this recipe, copy the fixed shape.)

## 4. Delete the policy record — the floor refuses to grade

```bash
rm -rf /tmp/config-guard-floor && cp -R clean /tmp/config-guard-floor
rm /tmp/config-guard-floor/docs/FEATURE-POLICY.md
bce gate --repo /tmp/config-guard-floor --blueprint-dir blueprint
```

```
::error::fail-closed: scanned 1 file(s), expected >= 2 for the 'plugin-surface' profile. An empty/partial scan can never score 100.
```

`extraction.minFiles: 2` is the existence floor: the manifest **and** its policy record must both
resolve, or the engine refuses to produce a green verdict at all. A governing document cannot be
deleted out from under a green gate — the scan that no longer sees it fails, never passes
vacuously.

## 5. Fix the drift and re-gate

Remove `"admin-console"` from `drift/config/feature-manifest.json` (or decide the widening is
*right*, and change the **blueprint** in a reviewed PR — the contract is data, so amending it is a
diff someone approves, not a silent constant edit). Re-run step 3: score 100, exit 0.

## What this example is really showing

- **Blueprints grade surfaces, not languages.** `extraction.paths` names files; the content-pattern
  scan is extension-agnostic. A JSON manifest, a Markdown policy, a YAML pipeline — if drift in a
  file can break your architecture, the file can carry a contract.
- **Config drift is architecture drift.** The most common way a "minimal by default" promise dies
  is not a code change — it is one quiet line in a manifest. A fail-closed required check on that
  manifest is cheap, and this is the whole recipe.
- **The engine reports its own limits.** `evaluator-refutable` is a weaker claim than `toothed`,
  made on purpose. The honest ladder is: teeth verdict for vacuity, a real-source mutation (the
  `drift/` tree) for substance, and the gate itself for enforcement.
