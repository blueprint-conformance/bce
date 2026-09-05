import { checkoutLabel } from '../app/view.js';

export interface Order {
  total: number;
}

export function priceOrder(order: Order): number {
  return order.total + checkoutLabel(order.total).length;
}
