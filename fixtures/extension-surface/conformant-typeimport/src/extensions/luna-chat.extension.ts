import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
import type { ClientOptions } from 'openai'; // TYPE-ONLY — erased, no runtime egress
export const lunaChatExtension: ExtensionFactory = (pi) => {
  pi.registerTool({ name: 'luna_chat', opts: null as ClientOptions | null });
};
export default lunaChatExtension;
