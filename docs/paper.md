# Blueprints with Teeth

**Fail-Closed Architecture Conformance for AI-Built Systems**

Design, Checker Validation, and First Production Experience of bce

Mitchell Tieleman · 36 pages · September 1, 2026 draft

> **Working draft — shared for discussion.** This version is still being revised. Feedback on the argument, methods, and unclear passages is welcome.

**[Read the working draft (PDF)](../assets/paper/blueprints-with-teeth-draft-2026-09-01.pdf)**

## What the paper explores

The same codebase can receive a perfect architecture score under one blueprint and fail under another, even when no code has changed. The difference is whether the rules can detect a violation.

The paper develops that problem through executable architectural contracts, checks that a blueprint can actually fail, validation of the checker itself, and evidence from the author's early deployment. It includes the system design, seeded-defect measurements, production incidents, and the limits of those observations.

## Reading this draft

This is a historical account of the system and its early deployment. Its measurements are scoped to the dates, engine versions, corpus, and author-operated environment stated in the paper. They do not establish general improvements in coding-agent outcomes or describe every capability in today's public engine.

For current released behavior and evidence, see the [specification](../spec/SPEC.md) and [Trust and evidence](https://blueprint-conformance.github.io/bce/trust/).

[Share feedback](https://github.com/blueprint-conformance/bce/issues/new) on the argument, methods, or unclear passages.
