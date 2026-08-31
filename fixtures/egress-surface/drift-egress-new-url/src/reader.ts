/**
 * FIXTURE — DRIFT: the ungoverned provider host is baked into a `new URL(...)` reached via a same-file const hop.
 */
const PROVIDER_URL = new URL('https://api.openai.com/v1/chat/completions');

export async function callProvider(): Promise<unknown> {
  const res = await fetch(PROVIDER_URL);
  return res.json();
}
