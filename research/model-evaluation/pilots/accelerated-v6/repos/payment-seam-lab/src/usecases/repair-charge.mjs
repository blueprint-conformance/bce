import { normalizeCharge } from '../infrastructure/raw-processor.mjs';
export function repairCharge(value) { return normalizeCharge(value).toLowerCase(); }
