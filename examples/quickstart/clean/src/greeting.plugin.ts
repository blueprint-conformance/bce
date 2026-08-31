/**
 * CONFORMANT plugin — the GREEN tree.
 *
 * The contract (blueprint/no-direct-http-client.blueprint.json) says: a plugin sends
 * network traffic through the governed host, never a directly-imported HTTP client.
 *
 * This plugin imports only the host's own types and calls `host.fetch(...)`, so the gate
 * scores it 100 (pass): there is no forbidden `axios` import edge anywhere in the file.
 */
import type { PluginFactory } from '@example/plugin-host';

export const greetingPlugin: PluginFactory = (host) => {
  host.registerTool({
    name: 'greeting',
    description: 'Fetch a greeting through the governed host.',
    parameters: {},
    async execute(args: Record<string, unknown>) {
      // Network egress goes through the host — auth, budget, and logging live there.
      const res = await host.fetch('/greeting');
      return { ok: true, data: res, echoed: args };
    },
  });
};

export default greetingPlugin;
