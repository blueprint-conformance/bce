import path from 'node:path';
export function repairRoute(value) { return path.posix.dirname(String(value)); }
