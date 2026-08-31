/**
 * FIXTURE — a CONFORMANT Luna chat extension in the REAL agent-host CURRIED shape.
 *
 * This models an ACTUAL-shaped `an-app-suite/agent-host/src/extensions/*.extension.ts` convention
 * (the dominant authoring form measured on a real plugin estate): an
 * exported `create…Extension(deps)` factory that RETURNS the `ExtensionFactory` — the `pi` harness is
 * the RETURNED arrow's first parameter, NOT the outer factory's (whose first param is `deps`).
 *
 * Pre-fix, the extractor captured the OUTER factory's first param (`deps`) as the harness, so
 * `pi.registerTool(...)` — living inside the returned arrow — was never credited and every real
 * extension scored 0/fail on `ext-registers-through-governed-path`. The curried-factory unwrap fix
 * descends one level into the returned function, so this scores GREEN like the direct-arrow form.
 */
import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
import { buildServiceHeaders } from '../config.js';

interface LunaChatDeps {
  routerUrl?: string;
}

export function createLunaChatExtension(deps: LunaChatDeps): ExtensionFactory {
  return async (pi) => {
    pi.registerTool({
      name: 'luna_chat',
      description: 'Send a chat turn to the Luna assistant through the governed router.',
      parameters: {},
      async execute(args: Record<string, unknown>) {
        const headers = buildServiceHeaders();
        return { ok: true, headers, routerUrl: deps.routerUrl, echoed: args };
      },
    });
  };
}
