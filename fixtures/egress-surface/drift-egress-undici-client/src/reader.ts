/**
 * FIXTURE — coverage-envelope Class A #2: the undici DISPATCHER CONSTRUCTOR egress form.
 *
 * `new undici.Client('https://api.openai.com')` opens a persistent connection to the provider; a
 * later `client.request({ path })` egresses to it. The host is baked into the CONSTRUCTOR's first
 * argument — a `NewExpression`, NOT a `CallExpression`. An egress scan that only visits
 * `CallExpression` nodes leaves the `new Client(...)` completely invisible: a provider reach with
 * ZERO disclosure (the `.request({path})` call resolves to nothing, folds into the opaque
 * unresolved count, and the actual host `api.openai.com` is never seen).
 *
 * `api.openai.com` is NOT governed, so the widened NewExpression pass recognizes the undici `Client`
 * constructor, resolves its literal-URL first argument to the host, emits a `type:'egress'` edge, and
 * the constraint scores this RED. The subsequent `c.request({ path })` (whose host is on the
 * constructor, not the call) is honestly itemized as a Class B advisory — never a false second edge.
 */
import { Client } from 'undici';

const c = new Client('https://api.openai.com');

export function callProviderUndici(): unknown {
  return c.request({ path: '/v1/chat/completions', method: 'POST' });
}
