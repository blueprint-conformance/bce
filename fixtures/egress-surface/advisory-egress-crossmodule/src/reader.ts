/**
 * FIXTURE — coverage-envelope Class B #4: the CROSS-MODULE const host.
 *
 * `fetch(`${PROVIDER_BASE}/v1`)` where `PROVIDER_BASE` is IMPORTED from `./host.ts`. The resolver's
 * same-file const-hop cannot cross the module boundary (a cross-module symbol is explicitly one of
 * the bounded-fidelity limits the honesty envelope declares), so the host is unresolvable — fail
 * OPEN, no edge, no false BLOCK.
 *
 * Like the env-only case, a naive scan folds this into an opaque aggregate count with no location. The
 * honesty fix ITEMIZES it in `coverage.unsupported` with its `path#Lnn` + callee — the honest "we
 * saw a network call we could not resolve to a host" disclosure. Advisory, never a violation. This
 * is a CONSERVATIVE choice, not a miss: resolving it would require cross-module symbol resolution
 * (over-reach — the declared-honest-coverage invariant), so the honest answer is to disclose the limit, not guess.
 */
import { PROVIDER_BASE } from './host.js';

export async function callCrossModule(): Promise<unknown> {
  const res = await fetch(`${PROVIDER_BASE}/v1/chat/completions`, { method: 'POST' });
  return res.json();
}
