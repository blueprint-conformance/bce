import { URL } from 'node:url'; export const serverHost = (value) => new URL(String(value)).hostname;
