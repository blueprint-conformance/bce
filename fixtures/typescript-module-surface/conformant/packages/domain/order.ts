export interface Order {
  total: number;
}

export function priceOrder(order: Order): number {
  return order.total;
}
