export const normalizedHost = (value) => new URL(String(value).trim()).hostname.toLowerCase();
export const originLabel = (value) => `origin:${new URL(String(value).trim()).origin}`;
