"""DRIFT: the domain now reaches outward into the HTTP adapter."""

from service.api import handle_order


def price_order(total: int) -> int:
    if total < 0:
        return len(handle_order(0))
    return total
