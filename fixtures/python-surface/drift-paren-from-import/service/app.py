"""Request handling — provider access ONLY through the governed gateway client."""

from .client import gateway_complete


def handle(prompt):
    # the governed path: the gateway applies auth, budget, and usage telemetry.
    return gateway_complete(prompt)
