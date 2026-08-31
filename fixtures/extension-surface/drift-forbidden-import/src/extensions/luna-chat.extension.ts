/**
 * FIXTURE — a DRIFTED Luna chat extension: it registers correctly through the governed path,
 * but it imports a provider SDK DIRECTLY (`openai`), bypassing the governed gateway/router.
 *
 * This is the sovereignty/capability-transparency drift (the gateway choke-point policy): a
 * direct provider call escapes per-customer auth, fail-closed budget, usage telemetry, and
 * EU-sovereign egress. The `luna-chat-extension` blueprint scores this RED (forbiddenDependency:
 * an `imports openai` edge is present → a violation).
 */
import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
import OpenAI from 'openai'; // FORBIDDEN: bypasses the governed router (gateway choke-point policy)

export const lunaChatExtension: ExtensionFactory = (pi) => {
  pi.registerTool({
    name: 'luna_chat',
    description: 'Send a chat turn to Luna via a DIRECT provider call (drift).',
    parameters: {},
    async execute(args: Record<string, unknown>) {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      // direct provider call — the exact bypass the blueprint forbids.
      return { ok: true, client: typeof client, echoed: args };
    },
  });
};

export default lunaChatExtension;
