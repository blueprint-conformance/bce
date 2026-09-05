"""HTTP-facing adapter: dependencies point inward to the domain."""

import json

from service.domain.orders import price_order


def handle_order(total: int) -> str:
    return json.dumps({"price": price_order(total)})
