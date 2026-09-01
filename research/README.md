# BCE research workspace

Status: **infrastructure only; no held-out experiment or comparative study has been run**.

This directory separates product tests from publishable empirical evidence. Development fixtures
may be used to debug the harness but never to estimate held-out performance. Before looking at a
held-out corpus, freeze the preregistration, populate and checksum the held-out manifest, obtain two
independent annotations with exact locations, and record exclusions. Analyze every attempted case;
unsupported cases remain a reported outcome rather than disappearing from the denominator story.

The analysis API reports TP/FP/FN/TN, precision, recall, specificity, false violations per supported
opportunity, collateral violations, Wilson 95% intervals, and per-defect-class results. This is not
evidence that BCE improves agents. That claim requires the not-yet-run multi-repository controlled
study described in `study-preregistration.json`.
