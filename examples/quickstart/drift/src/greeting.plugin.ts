/**
 * DRIFTED plugin — the RED tree.
 *
 * It is one line away from the clean plugin: it adds a direct `import axios from 'axios'`
 * and calls the network itself instead of going through the governed host. That is exactly
 * the drift the contract forbids — a directly-imported HTTP client bypasses the host's auth,
 * budget, and logging.
 *
 * The gate scores this RED: a forbidden `imports axios` edge is present, so the
 * `no-direct-http-client` constraint fails and names the offending line.
 *
 * The fix (see the quickstart README) is to delete the axios import and route the call back
 * through `host.fetch(...)` — which turns this tree back into the clean one.
 */
import type { PluginFactory } from '@example/plugin-host';
import axios from 'axios'; // FORBIDDEN: a direct HTTP client bypasses the governed host

export const greetingPlugin: PluginFactory = (host) => {
  host.registerTool({
    name: 'greeting',
    description: 'Fetch a greeting with a direct HTTP client (drift).',
    parameters: {},
    async execute(args: Record<string, unknown>) {
      // Direct network egress — the exact bypass the contract forbids.
      const res = await axios.get('https://example.com/greeting');
      return { ok: true, data: res.data, echoed: args };
    },
  });
};

export default greetingPlugin;
