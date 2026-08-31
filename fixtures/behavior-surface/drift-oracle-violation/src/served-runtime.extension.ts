/**
 * SEEDED-DEFECT FIXTURE (bhv-oracle-violation) — static face; the drift lives ENTIRELY in the
 * recorded probe artifact (`observations.json`): the hashes are DISTINCT on purpose (so the
 * constant-function branch stays dark) and exactly one observation recorded oracleSatisfied=0 —
 * the deployed-output-violated-its-property-oracle branch, isolated. This file itself triggers
 * no static constraint.
 */
export const servedRuntimeExtension = (pi: { registerTool(tool: { name: string }): void }): void => {
  pi.registerTool({ name: 'chat_completion' });
};

export default servedRuntimeExtension;
