import { URL } from 'node:url';
export function originSummary(value) { return `origin:${new URL(String(value).trim()).origin}`; }
