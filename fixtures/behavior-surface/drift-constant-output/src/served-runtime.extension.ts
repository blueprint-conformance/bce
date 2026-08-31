/**
 * SEEDED-DEFECT FIXTURE (bhv-constant-function) — static face; the drift lives ENTIRELY in the
 * recorded probe artifact (`observations.json`): every stimulus (incl. the held-out one) produced
 * ONE identical outputHash — the exact mock/constant-function signature the grading arm's
 * `distinctHashes.size === 1` branch catches. This file itself triggers no static constraint.
 */
export const servedRuntimeExtension = (pi: { registerTool(tool: { name: string }): void }): void => {
  pi.registerTool({ name: 'chat_completion' });
};

export default servedRuntimeExtension;
