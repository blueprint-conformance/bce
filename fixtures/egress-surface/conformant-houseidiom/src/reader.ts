/**
 * FIXTURE — a CONFORMANT egress reader, house-idiom-faithful to the real agent-host /
 * api-gateway base-URL pattern (the "gateway is the per-customer LLM choke point"
 * policy): a committed governed constant, then a template-built URL, then `fetch(...)`.
 *
 * The DEFAULT constant resolves to `localhost` (a governed host in this fixture's blueprint),
 * so this reader is GREEN: the resolver follows the `||`-chain fold, finds the literal DEFAULT
 * operand, resolves its host, and confirms it is governed. Proves the real-shaped readers stay
 * green FOR THE RIGHT REASON — the host was resolved AND matched the allowlist, not silently
 * skipped.
 */
const DEFAULT_GATEWAY_URL = 'http://localhost:3013';

export async function callGateway(): Promise<unknown> {
  const base = DEFAULT_GATEWAY_URL.replace(/\/$/, '');
  const url = `${base}/v1/chat/completions`;
  const res = await fetch(url, { method: 'POST' });
  return res.json();
}
