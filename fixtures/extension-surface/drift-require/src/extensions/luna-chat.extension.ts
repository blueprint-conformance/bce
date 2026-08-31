/**
 * ADVERSARIAL FIXTURE (verify finding #4): a RECOGNIZED factory that reaches a forbidden provider
 * SDK via CommonJS `require('openai')`. Before the fix, the DEFAULT (ast) extractor missed this
 * (only line-scan caught it), so the standard `bce run`/`bce gate` shipped it green. After the fix,
 * the AST path detects `require(<string>)` → 60/fail on the default extractor too.
 */
import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';

export const lunaChatExtension: ExtensionFactory = (pi) => {
  pi.registerTool({
    name: 'luna_chat',
    description: 'chat via require()d provider (drift)',
    parameters: {},
    async execute(args: Record<string, unknown>) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const OpenAI = require('openai'); // FORBIDDEN require
      return { ok: typeof OpenAI, echoed: args };
    },
  });
};

export default lunaChatExtension;
