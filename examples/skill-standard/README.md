# skill-standard — gating a skills/ tree, and the corpus that proves the clauses bite

The [quickstart](../quickstart/README.md) gates TypeScript source; [config-guard](../config-guard/README.md)
gates a JSON manifest and a policy document. This example gates **Agent Skills** — the
`skills/<name>/SKILL.md` layout a plugin, a marketplace entry, or a `.claude/skills/` directory
uses — against the [skill-standard](../../spec/skill-standard/SKILL-STANDARD.md).

It exists for a reason the other two examples do not have: this contract's clauses are almost all
content patterns, so on a clean tree `bce teeth` honestly reports most of them
`evaluator-refutable` rather than `toothed`. That verdict is not a substance proof, and the engine
says so. **The `drift/` tree here is the substance proof** — one seeded violation per clause, so
every clause in the standard has a demonstrated red rather than an assumed one.

```
examples/skill-standard/
├── clean/skills/
│   ├── greet/SKILL.md              # conformant                               → PASS
│   └── release-notes/SKILL.md      # conformant (two files: the minFiles floor)
└── drift/skills/
    ├── greet/SKILL.md              # S1 S2 S5 S6 S8 S10                       → RED
    ├── stub/SKILL.md               # S3   (a placeholder description)         → RED
    ├── bloated/SKILL.md            # S4   (1,134-character description)       → RED
    └── leaky/                      # S7 S9   (body) · S11a/b/c (files)        → RED
        ├── SKILL.md
        ├── .env · key.pem · id_rsa
        └── .gitignore              # un-ignores .env: an untracked fixture proves nothing
```

The contract itself is not copied here — it is
[`spec/skill-standard/skill-standard.blueprint.json`](../../spec/skill-standard/skill-standard.blueprint.json),
used directly. A third copy would be a third thing to drift.

Commands are run from **this directory** (`cd examples/skill-standard`). `bce` is the installed
CLI, exactly as in the quickstart.

## 1. Validate

```bash
bce validate --blueprint ../../spec/skill-standard/skill-standard.blueprint.json
```

```
blueprint VALID: skill-standard@0.1.0 (13 constraint(s))
```

Thirteen: ten content clauses, three file-shape clauses. The fourteenth property of the standard —
the two-file scan floor — is `extraction.minFiles`, not a constraint, which is why `clean/` carries
two skills rather than one.

## 2. The clean tree passes

```bash
bce run --blueprint ../../spec/skill-standard/skill-standard.blueprint.json \
  --ct-repo clean --no-pin --extractor ast --out /tmp/clean.json
```

```
ComplianceReport: skill-standard@0.1.0 @ unpinned -> score 100 (pass), 0 violation(s). 13 constraint(s) evaluated; 0 violation(s); score 100
```

Exit 0. Read `coverage.filesScanned` in the report before believing that score — a blueprint aimed
at a path that has moved also scores 100, against nothing at all.

## 3. The drift tree goes red — on every clause

```bash
bce run --blueprint ../../spec/skill-standard/skill-standard.blueprint.json \
  --ct-repo drift --no-pin --extractor ast --out /tmp/drift.json
```

```
ComplianceReport: skill-standard@0.1.0 @ unpinned -> score 0 (fail), 14 violation(s). 13 constraint(s) evaluated; 14 violation(s); score 0
```

Exit 1. Fourteen violations from thirteen constraints — S9 fires twice, once for each of the two
shapes it refuses. Every constraint id appears at least once:

| clause | fixture | anchor |
|---|---|---|
| S1 frontmatter-key-portability | `greet` | `skills/greet/SKILL.md#L4` |
| S2 name-shape | `greet` | `skills/greet/SKILL.md#L2` |
| S3 description-placeholder | `stub` | `skills/stub/SKILL.md#L3` |
| S4 description-budget | `bloated` | `skills/bloated/SKILL.md#L3` |
| S5 description-voice | `greet` | `skills/greet/SKILL.md#L3` |
| S6 no-model-pin | `greet` | `skills/greet/SKILL.md#L5` |
| S7 no-credential-material | `leaky` | `skills/leaky/SKILL.md#L9` |
| S8 no-author-machine-paths | `greet` | `skills/greet/SKILL.md#L10` |
| S9 no-harness-imitation | `leaky` | `skills/leaky/SKILL.md#L11`, `#L13` |
| S10 no-placeholder-body | `greet` | `skills/greet/SKILL.md#L13` |
| S11a no-dotenv | `leaky` | `skills/leaky/.env` |
| S11b no-pem | `leaky` | `skills/leaky/key.pem` |
| S11c no-ssh-key | `leaky` | `skills/leaky/id_rsa` |

That table is asserted, not transcribed: `tests/skill-standard.test.ts` re-derives it from a real
run and fails if any clause stops reddening. A clause that cannot be shown failing is decoration,
whatever the score says.

## 4. Why the teeth verdict differs between the two trees

This is the part worth reading twice.

```bash
bce teeth --blueprint ../../spec/skill-standard/skill-standard.blueprint.json --ct-repo clean --no-pin --extractor ast
```

```
TeethReport: skill-standard@0.1.0 -> toothed — 3/13 constraint(s) have EXTRACTOR-REAL teeth (already-red, or a mutation whose evidence the real extractor records); 10 evaluator-refutable (synthetic-evidence mutations — NOT evidence of real teeth; substance proof = a mutation corpus)
```

```bash
bce teeth --blueprint ../../spec/skill-standard/skill-standard.blueprint.json --ct-repo drift --no-pin --extractor ast
```

```
TeethReport: skill-standard@0.1.0 -> toothed — 13/13 constraint(s) have EXTRACTOR-REAL teeth (already-red, or a mutation whose evidence the real extractor records)
```

Same blueprint, same engine, same verdict word — and two very different claims behind it. On
`clean/` the ten content clauses can only be flipped with synthetic evidence, so the probe reports
`evaluator-refutable` for them: it proves the *evaluator* can refute the constraint, not that the
constraint bites anything the extractor really records. On `drift/` the violations are genuinely
there and genuinely recorded, so all thirteen are extractor-real.

**3/13 and 13/13 are the same blueprint's honest answers to two different questions.** Neither is
the gate. The gate is step 3.

## 5. Adopting it on your own tree

Copy the blueprint into your repository's `.blueprints/`, then edit three things — `scope.repositories`,
the `scope.paths`/`extraction.paths` pair, and **every constraint's `path` narrow**. The third is
the one that gets missed, and it fails in the worst direction: the clause is present, the blueprint
validates, and it grades an empty set.

The [`skill-tuning`](../../skills/skill-tuning/SKILL.md) skill drives the whole path, including the
brownfield route for a library that is already red on day one.

## A containment note about this directory

`drift/skills/leaky/` is a deliberately broken skill carrying a fake key and harness-imitating
text. It never loads into anyone's session, for two reasons that must both stay true:

1. It lives under `examples/`, and no plugin loader scans that. Only `skills/` is auto-discovered.
2. It is not named in [`.claude-plugin/plugin.json`](../../.claude-plugin/plugin.json)'s `skills`
   array. **That array is additive, not an allowlist** — it does not narrow discovery, it *adds*
   directories from outside `skills/`. Naming a fixture there would publish this file to every
   installer, and the manifest would still be schema-valid, so no validator would object.

`tests/skill-contract.test.ts` asserts both properties. Copy that assertion along with the corpus
if you adopt this pattern.
