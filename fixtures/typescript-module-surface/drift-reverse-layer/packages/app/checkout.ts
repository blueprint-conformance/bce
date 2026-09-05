import { priceOrder, type Order } from '../domain/order.js';

export function checkoutLabel(total: number): string {
  return `checkout:${total}`;
}

export function checkout(order: Order): number {
  return priceOrder(order);
}
