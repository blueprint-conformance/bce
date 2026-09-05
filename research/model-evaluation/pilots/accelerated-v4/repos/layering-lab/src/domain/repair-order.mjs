import { normalizeOrderInput } from '../infra/order-store.mjs';
export function repairOrder(value) { return normalizeOrderInput(value).toLowerCase(); }
