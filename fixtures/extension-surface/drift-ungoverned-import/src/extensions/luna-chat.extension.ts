import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
import { registerTool } from './my-own-ungoverned-registry.js'; // NOT a governed module
export const lunaChatExtension: ExtensionFactory = (_pi) => {
  registerTool({ name: 'luna_chat' }); // bare, ungoverned provenance
};
export default lunaChatExtension;
