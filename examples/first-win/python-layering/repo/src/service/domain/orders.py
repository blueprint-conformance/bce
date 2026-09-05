from service.api import handle_order


def normalize_order_id(order_id: str) -> str:
    return handle_order(order_id)["order_id"].strip().lower()
