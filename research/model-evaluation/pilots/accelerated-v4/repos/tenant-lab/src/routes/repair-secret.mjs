import { requireAuth } from '../security/generic-auth.mjs';
export function repairSecretRoute(tenantId, user) { const access = requireAuth(user); return `${tenantId}/${access.userId}`; }
