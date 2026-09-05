import { priceOrder, type Order } from '../domain/order.js';

export function checkout(order: Order): number {
  return priceOrder(order);
}
