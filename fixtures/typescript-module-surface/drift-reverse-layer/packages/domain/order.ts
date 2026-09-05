import { checkoutLabel } from '../app/checkout.js';

export interface Order {
  total: number;
}

export function priceOrder(order: Order): number {
  return checkoutLabel(order.total).length + order.total;
}
