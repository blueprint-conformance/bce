export const routeBasename = (value) => String(value).split('/').filter(Boolean).at(-1) ?? '';
export const joinRoute = (base, child) => `${String(base).replace(/\/$/, '')}/${String(child).replace(/^\//, '')}`;
export const normalizeRoute = (value) => `/${String(value).split('/').filter((part) => part && part !== '.').join('/')}`;
