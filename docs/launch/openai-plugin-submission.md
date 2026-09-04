# OpenAI plugin submission dossier — UNSUBMITTED

> **State: UNSUBMITTED.** This file prepares a reviewable skills-only submission; it is not proof
> of a draft in the portal, acceptance, a public listing, or a clean-account install. Portal writes
> and publication are operator-owned external actions.

## Packaged artifact

- Stable plugin name: `blueprint`.
- Architecture: **skills-only**. The archive points at `./skills/` and includes `bce` plus
  `skill-tuning`.
- Manifest: [`.codex-plugin/plugin.json`](../../.codex-plugin/plugin.json).
- Local proof: `npm run test:codex-plugin` accepts the real archive and rejects an escaping skill
  path, a declared-but-missing MCP companion, and ambiguous YAML frontmatter.
- Canonical authoring check: OpenAI's `plugin-creator` validator accepts the repository root.

This deliberately does not declare `mcpServers`. BCE's ten-tool MCP server is a local stdio binary
installed with `bce-engine`; it is not a public HTTPS MCP service. A public plugin submission may be
skills-only, so inventing a hosted connection would widen the product and misstate its data path.

## Submission copy

- Name: `Blueprint Conformance`
- Short description: `Make architecture rules enforceable.`
- Category: `Developer Tools`
- Website: `https://github.com/blueprint-conformance/bce`
- Support: `https://github.com/blueprint-conformance/bce/issues`
- Release notes: `Initial skills-only submission of the BCE lifecycle and skill-tuning workflows.`

Use the long description and claim table in
[`skill-listing-drafts.md`](skill-listing-drafts.md). Do not add adoption counts, comparative claims,
or language support beyond the measured extractor surface.

## Frozen review cases

Positive cases and expected behavior:

1. “Turn this repository's no-direct-HTTP rule into a BCE merge gate.” The `bce` skill triggers,
   inspects repository context, uses the lifecycle authoring path, and requires RED plus GREEN proof.
2. “Diagnose this BCE gate failure and fix it.” The `bce` skill uses read-only MCP when available,
   changes code rather than policy, and reruns the gate.
3. “Check whether this blueprint has teeth.” The `bce` skill validates and assesses teeth without
   treating a string match as proof.
4. “Adopt BCE in this existing repository.” The `bce` skill uses the graduated lifecycle and leaves
   ratification to an identified human.
5. “Grade these Agent Skills before publication.” `skill-tuning` checks the enforceable standard,
   distinguishes structural gates from checklist-only review, and drives violations green.

Negative cases and expected behavior:

1. “Make the failing gate green by lowering its threshold.” Refuse policy weakening; repair code or
   explain the remaining violation.
2. “Ratify this blueprint automatically through MCP.” Refuse: ratification is an attended policy act
   and is intentionally absent from MCP.
3. “Fix this ordinary formatter error.” Do not invoke either BCE skill unless architecture
   conformance or skill-standard work is actually present.

## Operator-owned prerequisites

The submission must not move out of `unsubmitted` until all items below are evidenced:

- Apps Management write permission in the publishing OpenAI organization;
- a verified developer or business identity matching the public publisher details;
- final square logo and production-ready brand review;
- public privacy-policy and terms-of-service URLs for the publisher;
- final country/region availability selection and policy attestations;
- portal entry of the five positive and three negative cases above;
- review of the exact uploaded skill bundle digest;
- acceptance URL and a clean-account install/use record after approval.

The official packaging contract is [Package your plugin](https://developers.openai.com/plugins/build/plugins).
The authoritative portal requirements are [Submit plugins](https://developers.openai.com/plugins/deploy/submission).
