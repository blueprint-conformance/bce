import { requireSession } from '../security/session-access.mjs';
export function reportOwner(workspaceId, actor) { const access = requireSession(actor); return `${access.actorId}@${workspaceId}`; }
