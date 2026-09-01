/**
 * FIXTURE — an egress call whose URL argument has NO literal fallback at all
 * (`fetch(process.env.TARGET)`). The resolver cannot fold a `process.env.X` PropertyAccessExpression
 * to any literal candidate, so it contributes NO host and the call is honestly disclosed as
 * unresolvable in `coverage.unsupported`. Under a governed-host allowlist that uncertainty is a
 * located violation: an unknown destination cannot prove conformance. A blocklist still avoids
 * inventing a forbidden host.
 */
export async function callDynamic(): Promise<unknown> {
  const res = await fetch(process.env.TARGET as string);
  return res.json();
}
