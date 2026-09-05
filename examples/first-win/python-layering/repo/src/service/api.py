"""Public HTTP adapter."""


def handle_order(order_id: str) -> dict[str, str]:
    return {"order_id": order_id}
