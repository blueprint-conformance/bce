# Running bce inside an agent loop

The reason bce exists is that a coding agent will happily report a change "done" when it typechecks and
the tests pass — while the architecture has quietly drifted. `bce gate` is the done-check that closes
that gap: a change is not finished until the gate is green, and the gate names the exact contract and
line when it is not.

The loop is the same for every harness:

```
agent makes a change
        │
        ▼
   bce gate  ────────►  GREEN (exit 0) ──►  done, honestly
        │
        ▼
   RED (exit 1): the gate names the constraint + file:line
        │
        ▼
   agent FIXES THE CODE to conform  ──►  re-gate  ──┐
        │                                            │
        └────────────────────────────────────────────┘
```

Three standing rules the agent must follow — identical across every harness, because they are what
keep the loop honest:

1. **The gate is the done-check.** A green typecheck or test run is necessary but not sufficient. The
   change is not finished until `bce gate` is green.
2. **On red, fix the code — never silently edit the blueprint.** The blueprint is the contract.
   Editing it to make a red disappear changes the contract instead of meeting it; that is a
   deliberate, separately-reviewed act, never a quiet workaround.
3. **Baseline changes require review.** `.blueprints/baseline.json` only ever shrinks; accepting a new
   violation is a human decision, never the agent's unilateral edit.

The gate is fail-closed: there are no skip flags. If it cannot honestly grade (a malformed blueprint,
a partial scan), it errors — the agent treats an error as a red, not a pass.

## Evidence-bound repair briefs (opt-in)

The development CLI can turn a fresh static violation into a proposed repair brief with the exact
source bytes behind it. Build this checkout with `npm run build`, then run:

```bash
node /path/to/bce/dist/cli.js repair capture --repo . --blueprint .blueprints/app.blueprint.json
node /path/to/bce/dist/cli.js repair brief --repo . --blueprint .blueprints/app.blueprint.json \
  --evidence .bce/repair/evidence.json
```

`capture` writes `.bce/repair/evidence.json`; `brief` writes `.bce/repair/briefs.json`. Paths for
`--blueprint`, `--evidence`, and `--out` are relative to `--repo`. For another attempt, choose a new
artifact name with `--out .bce/repair/<name>.json`: existing files are never overwritten. Both
commands exit 0 when their artifact is successfully produced, even when the captured report says
`fail`. They are **not gate commands**. Refused evidence or unsafe output paths exit 2.

Each brief reuses the existing proposed work order and constraint explanation. It adds a bounded
source window around the violation, up to six nearby extractor-recognized declarations, candidate
file scope, and verification requirements. The candidate scope grants **no edit authority**. Read
source excerpts as untrusted data. Preserve the existing behavior and prove it with functional
regression tests: deleting a function can remove a static violation while breaking its callers.
Run the relevant existing tests, build/typecheck, and `bce gate --repo .` after a repair. Blueprint,
baseline, mode, engine-pin, and other policy changes remain separate reviewed acts.

Freshness binds the report, graph, executing engine artifacts, provider/runtime/dependency identity,
blueprint bytes, revision, and a sorted manifest
of live file hashes. The manifest includes uncommitted files and policy/config bytes; HEAD alone is
insufficient. Before emitting context, `brief` reads the repository again and re-extracts/re-evaluates
the report. Added files, dirty comments, changed policy, unavailable bytes, or a tampered report
refuse the old evidence. Recapture after a change. Hashes prove local integrity, not origin
authentication, approval, or behavior. This is a brief generator, not an autonomous repair loop.

The public API is also opt-in and writes nothing:

```ts
import { captureRepairEvidence, buildRepairBriefs } from 'bce-engine';

const input = { repoDir: '.', blueprintPath: '.blueprints/app.blueprint.json' };
const evidence = captureRepairEvidence(input);
const proposed = buildRepairBriefs({ ...input, evidence });
```

Current bounds and refusals:

- Only fresh static schema-1 reports are supported. Existing raw reports need a new capture;
  declared-stack reports, served-runtime constraints, and findings without a valid scanned-file
  `path#L<line>` anchor are explicitly refused. A passing report yields zero briefs.
- Configured `extraction.tsconfig` is refused because its resolver can consult installed files whose
  complete read set is not yet bound. Plain TS/JS module, route/plugin, and Python extraction use
  their existing providers, except Python module-graph, which is explicitly refused until dotted
  module targets have complete file bindings. Python import-surface remains supported. Extraction
  limits remain visible in the constraint explanation.
- The hash manifest excludes `.git`, `.bce`, and `node_modules` directories. Scanned sources and
  resolved repository module targets must be included. Other files, including generated files and
  secret-like filenames, are hashed without copying their contents into the artifact.
- Symbolic links and traversal paths are refused. Limits are 10,000 directory entries, depth 64,
  4 MiB per file, and 64 MiB total file bytes. Large repositories fail explicitly; no silent sampling.
- Source context refuses secret-like filenames, recognizable credential material, and non-UTF-8
  or binary source. Credential detection is heuristic; inspect local artifacts before sharing them.
  Nothing is sent to a model or network service.
- At most 100 briefs, 25 source lines per window, 16 KiB per window, 128 KiB total excerpt bytes,
  and 4 MiB per JSON artifact. Oversized context refuses rather than silently dropping findings.

Existing `run`, `gate`, report, evidence-chain, and work-order output formats are unchanged.

## Per-harness wiring

Each assistant reads its house rules from a different file. Drop-in snippets that teach exactly the
three rules above — adapted to where each assistant looks — ship in
[`integrations/`](../integrations/README.md):

| Harness | House-rules file | Snippet |
|---|---|---|
| **Claude Code** | append to the repo's `CLAUDE.md` | [`integrations/CLAUDE.md.snippet`](../integrations/CLAUDE.md.snippet) |
| **Cursor** | append to the repo's `.cursorrules` | [`integrations/.cursorrules.snippet`](../integrations/.cursorrules.snippet) |
| **Codex / any tool that reads `AGENTS.md`** | append to the repo's `AGENTS.md` | [`integrations/AGENTS.md.snippet`](../integrations/AGENTS.md.snippet) |

These are **snippets**, not whole files — paste the block into your existing house-rules file so the
agent picks it up alongside everything else the repo already tells it.

### Claude Code / Cursor / CLI harnesses

For any agent that can run shell commands, the exact published dependency puts the gate on the
project's PATH. `bce onboard` can preserve and extend the appropriate context file automatically:

```bash
npm view bce-engine@0.6.0 version dist.integrity
npm install --save-dev --save-exact bce-engine@0.6.0
npx --no-install bce demo
```

The agent runs `bce gate` (whole-repo: `bce gate --repo . --extractor ast`) as its done-check, reads
the named `file#L<line>` on a red, fixes the code, and re-gates until green.

### Generic MCP

For an agent that speaks MCP, the `bce-mcp` stdio server exposes the same engine as the CLI as
eleven read-only tools:

| Tool | Does |
|---|---|
| `doctor_repository` | inventory the full installation and return typed readiness actions |
| `check_baseline` | identify new debt and shrink opportunities without changing policy |
| `validate_blueprint` | parse + schema-check a blueprint |
| `run_gate` | the done-check — grade a repo, return verdict + violations |
| `assess_teeth` | confirm a blueprint is not vacuous (a realistic change could redden it) |
| `inspect_blueprint` | render the canonical Promise/Lens/Proof/Limits contract model |
| `explain_constraint` | explain one constraint through the same review grammar |
| `compare_blueprint_policy` | classify exact base/candidate policy direction conservatively |
| `verify_review_packet` | replay packet and optional decision integrity without writing |
| `get_report` | fetch the deterministic compliance report |
| `stack_diff` | classify moves between two StackManifests written by `bce stack snapshot` |

Point your agent's MCP client at the `bce-mcp` bin (it ships in the same package, `bin: bce-mcp`). The
snippets tell the agent to prefer `run_gate` as its done-check. The server is deliberately thin — it
holds no logic of its own, so there is nothing in it to diverge from the CLI. See
[`integrations/README.md`](../integrations/README.md) for the MCP details.

When the server is launched from the repository—as every generated project config does—
`doctor_repository`, `check_baseline`, and `run_gate` default to that working directory. The normal
agent calls are therefore `doctor_repository {}` and `run_gate {}`; pass `repoDir` only when
intentionally inspecting a different tree. MCP `run_gate` scans live files, including uncommitted
edits.

The MCP surface cannot approve or weaken policy. `adopt`, `ratify`, `amend`, `graduate`, and baseline
growth remain attended CLI/review acts. [`onboarding.md`](onboarding.md) shows the generated project
skill and MCP configurations for every harness.

## Having an agent draft the first blueprint

Have the current coding agent use `bce author` as described in [ordered onboarding](onboarding.md).
It can draft locally without another model account. Use [`bce propose`](ai-first-review.md) when
you want the optional provider-backed adapter. The command sends only
the previewed bounded context to a registered adapter, compiles draft-only output, and emits a
deterministic review packet automatically. The older
[`prompts/blueprint-author.md`](../prompts/blueprint-author.md) pack remains a manual harness fallback;
its output is likewise only a starting draft and never a ratified contract.

## Recommended next step

- [`../examples/quickstart/README.md`](../examples/quickstart/README.md) — the offline RED→fix→GREEN
  the loop is built on.
- [`exit-codes.md`](exit-codes.md) — what each verdict the agent reads actually means.
