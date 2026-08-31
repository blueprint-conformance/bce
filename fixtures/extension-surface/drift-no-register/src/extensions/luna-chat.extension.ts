/**
 * FIXTURE — a DRIFTED Luna chat extension: it is a recognizable extension factory, but it
 * NEVER registers its tool through the governed `pi.registerTool(...)` path. Instead it pushes
 * onto some ad-hoc array — bypassing the harness (and therefore the tool-access class, budget,
 * and audit the governed path enforces).
 *
 * This is exactly the implementation drift a blueprint gate must catch on a contributor's PR:
 * the extension "works" and typechecks, but it side-steps the governed registration. The
 * `luna-chat-extension` blueprint scores this RED (requiredDependency: a `provides` edge is
 * missing → a violation at the constraint severity).
 */
import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';

const adhocTools: unknown[] = [];

export const lunaChatExtension: ExtensionFactory = (_pi) => {
  // DRIFT: bypasses pi.registerTool — the governed path is not taken.
  adhocTools.push({
    name: 'luna_chat',
    description: 'Send a chat turn to Luna (ungoverned registration).',
    execute: async (args: Record<string, unknown>) => ({ ok: true, echoed: args }),
  });
};

export default lunaChatExtension;
