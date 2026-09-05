import { requireSession } from '../security/session-access.mjs';
export function repairReport(workspaceId, actor) { const access = requireSession(actor); return `${workspaceId}/${access.actorId}`; }
