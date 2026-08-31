/**
 * FIXTURE — DRIFT: the ungoverned provider is reached via the fully-qualified `globalThis.fetch(...)` form.
 */
export async function callProvider(): Promise<unknown> {
  const res = await globalThis.fetch('https://api.openai.com/v1/chat/completions', { method: 'POST' });
  return res.json();
}
