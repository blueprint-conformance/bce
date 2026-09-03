import { generate } from './provider-sdk.mjs';
export async function callProvider(name) { return generate(name); }
