/**
 * FIXTURE — a DRIFTED egress reader: the SAME house idiom as `conformant-houseidiom`
 * (`(a || b || DEFAULT).replace(...)` then a template URL then `fetch(...)`), but the DEFAULT
 * constant resolves to an UNGOVERNED provider host (`api.openai.com`) instead of a governed one.
 *
 * This is the realistic drift shape the capability-transparency invariant exists to catch:
 * a reader that LOOKS governed (same idiom, same fallback-chain structure) but whose baked-in
 * default silently reaches a provider directly, bypassing the gateway's per-customer auth,
 * fail-closed budget, and usage telemetry. The forbiddenEgress constraint scores this RED: the
 * resolver folds the `||`-chain, finds `D` as a literal candidate, resolves its host to
 * `api.openai.com`, and — because that host is NOT in `governedHosts` — emits a `type:'egress'`
 * edge, which the constraint reports as a critical violation.
 */
const D = 'https://api.openai.com';

export async function callProvider(opts: { baseUrl?: string }): Promise<unknown> {
  const base = (opts.baseUrl || process.env.PROVIDER_URL || D).replace(/\/$/, '');
  const url = `${base}/v1/chat`;
  const res = await fetch(url, { method: 'POST' });
  return res.json();
}
