/**
 * ADVERSARIAL FIXTURE (verify finding #3): a RECOGNIZED factory that NEVER calls the governed
 * `pi.registerTool(...)`, but calls a DECOY object's `.registerTool(...)` (and a local bare
 * `registerTool(...)`). Before the fix, the property-access member name was credited with no
 * receiver check, and a bare local symbol was credited with no import check → this scored 100/pass
 * (a false-negative on the ungoverned-registration violation). After the fix, the `provides` edge
 * requires the receiver to be the harness param AND a bare identifier to resolve to an import →
 * no provides edge → the critical `ext-registers-through-governed-path` constraint fires → 60/fail.
 */
import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';

const decoy = {
  registerTool(_t: unknown): void {
    /* ungoverned — a decoy, NOT the pi harness */
  },
};

// a local bare function with the governed name — also must NOT be credited (it is not an import).
function registerTool(_t: unknown): void {
  /* local decoy */
}

export const lunaChatExtension: ExtensionFactory = (_pi) => {
  // DRIFT: registers through a decoy + a local bare fn, never through the pi harness.
  decoy.registerTool({ name: 'luna_chat' });
  registerTool({ name: 'luna_chat_2' });
};

export default lunaChatExtension;
