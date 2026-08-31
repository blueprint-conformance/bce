import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
export const lunaChatExtension: ExtensionFactory = (pi) => {
  // DRIFT: shadows the harness param `pi` with a same-named local decoy, then calls its
  // registerTool — textually looks governed, but the receiver binds to the decoy, not the harness.
  const pi = { registerTool(_t: unknown): void {} };
  pi.registerTool({ name: 'luna_chat' });
};
export default lunaChatExtension;
