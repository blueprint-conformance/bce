# Week-1 triage — launch SLA

Scope: the first 7 days after the public launch post. After week 1, fall
back to the standing cadence in [GOVERNANCE.md](../../GOVERNANCE.md).

## Response targets (week 1)

| Class | First response | Resolution target |
| --- | --- | --- |
| Security report (per [SECURITY.md](../../SECURITY.md)) | < 12 h | private fix branch ASAP; no public triage |
| Broken quickstart / install (`bce-engine` unusable) | < 12 h | patch release < 48 h |
| Wrong verdict (false RED or false GREEN with repro) | < 24 h | repro → corpus candidate < 72 h |
| Docs gap / confusing error | < 24 h | batch fix by day 7 |
| Feature request | < 48 h | label + roadmap disposition; no week-1 commitments |
| Comparison-page correction from a listed tool's maintainer | < 24 h | correction merged < 48 h (their wording wins on their tool) |

## Label taxonomy

`bug` · `false-verdict` (subclass of bug; always asks for the two-tree
repro) · `quickstart` · `docs` · `corpus-candidate` (a real drift class the
corpus misses — the most valuable inbound) · `extractor-python` (the named
community target) · `spec` (routes to the RFC process) · `question` ·
`wontfix-scope` (outside the deliberately-narrow scope; close with a
pointer to docs/comparison.md).

## Auto-close / escalate

- **Auto-close** (polite template, after one warning): hype-war threads,
  "compare yourself to X" without a concrete scenario (point to
  docs/comparison.md and invite a PR), drive-by feature lists.
- **Escalate to maintainer immediately**: any security report; any
  reproducible false-GREEN (a gate that passes drift is the worst failure
  this project can have — treat as P0); any claim that the measured-recall
  number is wrong or gamed.

## Rotation

Week 1 is staffed by the maintainer (generic: whoever holds the
`maintainer` role in GOVERNANCE.md), checking inbound at least twice daily.
A missed SLA is logged in the issue thread honestly — no silent lateness.
