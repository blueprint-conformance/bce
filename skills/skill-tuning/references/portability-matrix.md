# Portability — the core, the extensions, and what crossing the line costs

Read this when deciding whether a frontmatter key belongs in a skill, and before "fixing" an S1
violation by re-spelling the key.

## The two sets

Agent Skills is an open format with a portable core, and Claude Code adds extensions on top of it.
The distinction is not stylistic: consumers of the portable core **reject** unknown keys rather
than ignoring them.

| Set | Keys |
|---|---|
| **Portable core** — accepted everywhere the open format is | `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` |
| **Claude Code extensions** — accepted by Claude Code, rejected by portable-core consumers | `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `disallowed-tools`, `model`, `effort`, `context`, `agent`, `background`, `hooks`, `paths`, `shell` |

Note the spelling is not uniform across the extension set — some keys hyphenate and one uses
underscores. That inconsistency is the entire reason S1 exists: it is genuinely easy to invent the
wrong one, and nothing tells you that you did.

## What rejection looks like

A claude.ai upload, the Skills API, and the packaging script all refuse a file carrying an
extension key, with a message of this shape:

> Unexpected key(s) in SKILL.md frontmatter: argument-hint. Allowed properties are: allowed-tools,
> compatibility, description, license, metadata, name

That is the whole cost, stated plainly: an extension key is not a portability *risk*, it is a
portability *decision*. The file works in Claude Code and does not upload.

## Deciding an S1 violation

Three outcomes, in the order to consider them:

1. **Delete the key.** Correct whenever nobody can say what it was for — which, for a key that has
   never been read by anything, is the common case. It has had no effect for the life of the file;
   removing it changes nothing except that the file is now honest.
2. **Re-spell it as a portable-core key.** Available only if the intent maps onto the core set.
   `allowed_tools` → `allowed-tools` is the clean instance of this.
3. **Re-spell it as an extension, deliberately.** Correct when the behaviour is genuinely wanted
   and the skill is not published to a portable-core consumer. Record the choice where a reader
   will find it — a comment in the body, or the pull request description — because the next person
   to see the key will otherwise treat it as the same defect S1 just caught.

The one wrong answer is re-spelling it as an extension *by reflex* because that was clearly the
intent. It makes a previously-uploadable file non-uploadable, silently, in a change whose stated
purpose was to fix a portability clause.

## Budgets

Numbers a skill is measured against, worth knowing before writing rather than after:

| Budget | Value | What happens at the limit |
|---|---|---|
| Combined description text in the listing | 1,536 characters | Truncated — across all skills, so one long description consumes another skill's routing text. S4 is the guard. |
| `compatibility` | 500 characters | — |
| `SKILL.md` body | under 500 lines (documented guidance) | Deeper material belongs in `references/`, read only when needed. |
| Per-skill context on compaction | first 5,000 tokens, within a 25,000-token shared budget | Material past the cut is not there when it matters. |

## Paths

Two substitutions make a bundled path portable. Use them instead of any literal absolute path —
this is the S8 fix:

| Substitution | Resolves to |
|---|---|
| `${CLAUDE_SKILL_DIR}` | the directory of the skill being executed |
| `${CLAUDE_PLUGIN_ROOT}` | the root of the plugin the skill was installed from |

A relative path is not a substitute for either. The working directory when a skill runs is the
user's project, not the skill's own directory, so `references/thing.md` resolves against the wrong
root — and does so silently, because the file is simply not found rather than reported as
misconfigured.
