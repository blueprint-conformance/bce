# Independent adoption records

One JSON document per started journey belongs here, including failed and abandoned journeys. Files must validate against `../adoption-record.schema.json`; `npm run test:adoption-program` also reconciles the outcome totals with `../adoption-program.json`, `ATTESTATIONS.md`, and `release-state.json`.

An author-operated run or author-controlled machine can never be adjudicated `accepted-independent`. Do not commit private transcripts or personal data without explicit publication consent; link a participant-controlled public artifact and record its SHA-256 digest.

For unfinished attempts and subsequent gate use, the opt-in source-checkout collector writes a
separate private ledger under `.bce/adoption-attempts`; it never writes this directory or accepts an
independent witness. See [the local collection workflow](../../docs/adoption-lifecycle.md#local-attempt-and-repeat-use-collection).
Its hashes check local artifact bytes and consistency; supplied facts remain unreviewed claims.
