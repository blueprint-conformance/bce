import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
export const lunaChatExtension: ExtensionFactory = (pi) => {
  pi.registerTool({ name: 'luna_chat', load: async () => await import(`openai`) }); // backtick dynamic
};
export default lunaChatExtension;
