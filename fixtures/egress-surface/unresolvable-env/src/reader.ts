/**
 * FIXTURE — an egress call whose URL argument has NO literal fallback at all
 * (`fetch(process.env.TARGET)`). The resolver cannot fold a `process.env.X` PropertyAccessExpression
 * to any literal candidate, so it contributes NO host and the call is honestly disclosed as
 * unresolvable in `coverage.unsupported` — it must NEVER be reported as a violation (fail-OPEN on
 * detection: an ambiguous call is not evidence of drift, and a conformant dynamic reader must
 * never be false-blocked).
 */
export async function callDynamic(): Promise<unknown> {
  const res = await fetch(process.env.TARGET as string);
  return res.json();
}
