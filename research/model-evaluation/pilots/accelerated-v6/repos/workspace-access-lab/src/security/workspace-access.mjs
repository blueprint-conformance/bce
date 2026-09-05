export const requireWorkspaceAccess = (workspaceId, actor) => { if (!actor?.id || actor.workspaceId !== workspaceId) throw new Error('forbidden'); return { workspaceId, actorId: actor.id }; };
