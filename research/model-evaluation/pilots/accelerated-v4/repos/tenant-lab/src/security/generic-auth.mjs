export const requireAuth = (user) => { if (!user?.id) throw new Error('unauthorized'); return { tenantId: user.tenantId, userId: user.id }; };
