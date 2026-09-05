import { URL } from 'node:url';
export function repairHost(value) { return new URL(String(value)).host.toUpperCase(); }
