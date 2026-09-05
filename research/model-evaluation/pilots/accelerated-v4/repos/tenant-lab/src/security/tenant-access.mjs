export const requireTenantAccess = (tenantId, user) => { if (!user?.id || user.tenantId !== tenantId) throw new Error('forbidden'); return { tenantId, userId: user.id }; };
