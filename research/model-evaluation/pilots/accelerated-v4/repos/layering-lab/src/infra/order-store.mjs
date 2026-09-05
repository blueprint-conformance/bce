export const normalizeOrderInput = (value) => String(value).trim().toUpperCase();
export const createOrderRecord = (id) => `order:${String(id).trim()}`;
export const formatOrderLabel = (id) => `Order ${String(id).trim()}`;
