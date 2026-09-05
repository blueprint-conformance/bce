import path from 'node:path';
export function normalizedRoute(value) { return `/${path.posix.normalize(String(value)).replace(/^\//, '')}`; }
