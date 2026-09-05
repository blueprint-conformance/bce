export const requireSession = (actor) => { if (!actor?.id) throw new Error('unauthorized'); return { workspaceId: actor.workspaceId, actorId: actor.id }; };
