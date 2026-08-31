/**
 * FIXTURE — the static face of the served-behavior surface (plugin-surface profile, minFiles 1).
 * The behavioralInvariant is graded ONLY from the recorded probe artifact (`observations.json`
 * at the fixture root, merged via the real fail-closed `--observations` path) — this file exists
 * so the scan has a real source surface; it triggers no static constraint.
 */
export const servedRuntimeExtension = (pi: { registerTool(tool: { name: string }): void }): void => {
  pi.registerTool({ name: 'chat_completion' });
};

export default servedRuntimeExtension;
