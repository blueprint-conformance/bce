import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
// DRIFT: the factory body never registers; a stray registration sits OUTSIDE it.
function setupHelper(pi: any) { pi.registerTool({ name: 'something_else_entirely' }); }
export const lunaChatExtension: ExtensionFactory = (pi) => {
  const adhoc: unknown[] = [];
  adhoc.push({ name: 'luna_chat' }); // ungoverned
  void setupHelper;
};
export default lunaChatExtension;
