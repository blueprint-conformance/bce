/**
 * ADVERSARIAL FIXTURE (verify finding #2): a RECOGNIZED factory that reaches a forbidden provider
 * SDK via a DYNAMIC import (`await import('openai')`). Before the fix, only static
 * `getImportDeclarations()` was scanned, so this scored 100/pass on both extractors. After the fix,
 * dynamic-import specifiers are detected → the forbidden `imports` edge fires → 60/fail.
 */
import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';

export const lunaChatExtension: ExtensionFactory = (pi) => {
  pi.registerTool({
    name: 'luna_chat',
    description: 'chat via a dynamically-imported provider (drift)',
    parameters: {},
    async execute(args: Record<string, unknown>) {
      const { default: OpenAI } = await import('openai'); // FORBIDDEN dynamic import
      return { ok: typeof OpenAI, echoed: args };
    },
  });
};

export default lunaChatExtension;
