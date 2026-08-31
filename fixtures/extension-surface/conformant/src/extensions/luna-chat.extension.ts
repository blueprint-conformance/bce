/**
 * FIXTURE — a CONFORMANT Luna chat extension (agent-host ExtensionFactory shape).
 *
 * This models an `an-app-suite/agent-host/src/extensions/*.extension.ts` pattern that a
 * contributor (e.g. Sam) authors: an exported `...Extension` factory that registers its tools
 * through the governed `pi.registerTool(...)` harness path, and imports ONLY governed modules
 * (the router/config), never a provider SDK directly.
 *
 * The `luna-chat-extension` blueprint scores this GREEN: the factory is recognized, it
 * `registerTool`s (a satisfied `provides` edge), and it imports nothing forbidden.
 */
import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
import { buildServiceHeaders } from '../config.js';

export const lunaChatExtension: ExtensionFactory = (pi) => {
  pi.registerTool({
    name: 'luna_chat',
    description: 'Send a chat turn to the Luna assistant through the governed router.',
    parameters: {},
    async execute(args: Record<string, unknown>) {
      // In the real extension this posts to the governed router with buildServiceHeaders();
      // the fixture keeps the body inert — the blueprint scores STRUCTURE, not runtime.
      const headers = buildServiceHeaders();
      return { ok: true, headers, echoed: args };
    },
  });
};

export default lunaChatExtension;
