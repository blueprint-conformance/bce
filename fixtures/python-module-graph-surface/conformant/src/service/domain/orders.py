"""Domain calculation with no dependency on the delivery layer."""


def price_order(total: int) -> int:
    return max(total, 0)
