# The bce Agent Skills

This directory holds bce packaged as **Agent Skills** — the folder-per-skill format
(`<skill-name>/SKILL.md`, with YAML frontmatter naming and describing the skill) that Claude Code
and other Agent-Skills consumers load on demand. Two skills ship here:

- [`bce/SKILL.md`](bce/SKILL.md) — the whole lifecycle: author a blueprint, validate it, run it,
  prove it can go red, wire it as a gate, plus the honesty invariants that keep the result
  meaningful.
- [`skill-tuning/SKILL.md`](skill-tuning/SKILL.md) — the engine turned on this format itself:
  grade a `skills/` tree against the [skill-standard](../spec/skill-standard/SKILL-STANDARD.md) and
  drive it green. The gated half of that standard is a blueprint; the half the engine structurally
  cannot gate is a checklist, and the skill says which is which.

Both are a **surface over the engine**, exactly like everything in
[`integrations/`](../integrations/README.md): they contain no conformance logic. Every command they
teach is a real `bce` verb with real flags, and
[`tests/skill-contract.test.ts`](../tests/skill-contract.test.ts) fails the build if the skill ever
names a verb or flag the CLI does not accept.

This directory is also held to the standard it publishes:
[`.blueprints/skill-standard.blueprint.json`](../.blueprints/skill-standard.blueprint.json) gates
`skills/**` on every run of the self-gate, and
[`tests/skill-standard.test.ts`](../tests/skill-standard.test.ts) runs the required-half checks that
no blueprint clause can express. A standard whose author's own skills did not pass it would not be
worth publishing.

## Installing it

### As a Claude Code plugin

This repository is also a plugin marketplace: it carries
[`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json) offering one plugin,
`blueprint`, whose source is the repository root
([`.claude-plugin/plugin.json`](../.claude-plugin/plugin.json)). Adding the marketplace and
installing the plugin is two lines, and updates arrive with `/plugin update`:

```
/plugin marketplace add blueprint-conformance/bce
/plugin install blueprint@bce
```

The skills then load as `blueprint:bce` and `blueprint:skill-tuning`. Both manifests are
re-validated on every push —
`claude plugin validate . --strict`, in [`ci.yml`](../.github/workflows/ci.yml) — so a stale
skill path is a red build rather than a load failure in your session.

To try it from a local checkout without installing anything, load the directory for one session:

```bash
claude --plugin-dir /path/to/bce
```

### As a plain skill directory

A skill is also just a directory, and nothing above is required to use one. Put it where your
assistant looks for skills:

```bash
# Claude Code, for one project
mkdir -p .claude/skills
cp -R path/to/bce/skills/bce .claude/skills/bce
cp -R path/to/bce/skills/skill-tuning .claude/skills/skill-tuning

# Claude Code, for every project on this machine
mkdir -p ~/.claude/skills
cp -R path/to/bce/skills/bce ~/.claude/skills/bce
cp -R path/to/bce/skills/skill-tuning ~/.claude/skills/skill-tuning
```

Take either on its own — they are independent. Any other Agent-Skills consumer reads the same
folder-per-skill layout; point it at `skills/bce` or `skills/skill-tuning` per its own
documentation.

Copy the whole directory, not just `SKILL.md`: `skill-tuning` reads its `references/` on demand,
and a skill whose references are missing fails by finding nothing rather than by reporting it.

The skill drives the `bce` CLI, so the command has to be reachable. Before npm publication, install
an exact reviewed Git commit in the target project; its `prepare` script builds both package bins:

```bash
npm install --save-dev \
  "git+https://github.com/blueprint-conformance/bce.git#<reviewed-40-character-commit-sha>"
npx --no-install bce demo
```

Do not install the registry's `0.0.0` reservation stub. The Git-installed package also contains
`skills/`, `prompts/`, integration snippets, schemas, and onboarding docs, so copying a plain skill
from `node_modules/bce-engine/skills/` does not require a second checkout.

## Skill, snippet, or MCP server?

Three surfaces, three different jobs. They compose; they are not alternatives to each other.

| Surface | What it is | Reach for it when |
|---|---|---|
| **Agent Skill** (this directory) | On-demand lifecycle instructions — the full author → validate → run → teeth → gate path, loaded when the agent needs it | An agent is *creating* a contract, or adopting the gate on a repository for the first time |
| **House-rules snippet** ([`integrations/`](../integrations/README.md)) | An always-loaded block of three standing rules for a repository that already has a blueprint | An agent is *working inside* a gated repository day to day |
| **MCP server** (`bce-mcp`, ships with the package) | Six read-only tools: readiness + baseline diagnosis, validation, gate, teeth, and report reading | The agent speaks MCP and should call the gate rather than shell out |

The snippet is the standing done-check; the skill is the thing that gets a contract to exist in the
first place.

## Related reading

- [`../docs/quickstart.md`](../docs/quickstart.md) — the offline RED to GREEN walkthrough, five
  minutes, no network beyond one install.
- [`../docs/agent-loop.md`](../docs/agent-loop.md) — running the gate as an agent's done-check, per
  harness.
- [`../docs/onboarding.md`](../docs/onboarding.md) — install and compose CLI, skill, context, MCP,
  CI, lifecycle, and evidence as one stack.
- [`../spec/SPEC.md`](../spec/SPEC.md) — the normative artifact model, taxonomy, scoring, and exit
  codes the skill's commands are grounded in.
