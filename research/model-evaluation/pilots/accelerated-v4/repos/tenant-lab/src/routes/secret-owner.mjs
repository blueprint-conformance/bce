import { requireAuth } from '../security/generic-auth.mjs';
export function secretOwnerRoute(tenantId, user) { const access = requireAuth(user); return `${access.userId}@${tenantId}`; }
