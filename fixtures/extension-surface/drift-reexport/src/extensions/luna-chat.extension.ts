import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
export { default as OpenAI } from 'openai'; // FORBIDDEN re-export
export const lunaChatExtension: ExtensionFactory = (pi) => { pi.registerTool({ name: 'luna_chat' }); };
export default lunaChatExtension;
