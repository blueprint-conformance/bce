"""The governed gateway client — the single provider choke point."""

import json
import os
from urllib import request


def gateway_complete(prompt):
    url = os.environ.get("GATEWAY_URL", "http://localhost:3013") + "/v1/chat/completions"
    body = json.dumps({"messages": [{"role": "user", "content": prompt}]}).encode()
    req = request.Request(url, data=body, headers={"content-type": "application/json"})
    with request.urlopen(req) as resp:  # gateway-internal call, governed upstream
        return json.load(resp)
