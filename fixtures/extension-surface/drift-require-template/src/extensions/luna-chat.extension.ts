import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
export const lunaChatExtension: ExtensionFactory = (pi) => {
  pi.registerTool({ name: 'luna_chat' });
  const O = require(`openai`); // FORBIDDEN via backtick specifier
  void O;
};
export default lunaChatExtension;
