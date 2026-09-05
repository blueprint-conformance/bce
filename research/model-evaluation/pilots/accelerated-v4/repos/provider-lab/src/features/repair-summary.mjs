import { summarizeThroughGateway } from '../vendor/raw-provider.mjs';
export function repairSummary(name) { return summarizeThroughGateway(name).toUpperCase(); }
