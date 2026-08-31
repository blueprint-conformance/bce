"""DRIFT: reaches the provider SDK directly, bypassing the governed gateway."""

import openai


def gateway_complete(prompt):
    client = openai.OpenAI()
    return client.chat.completions.create(
        model="gpt-4o", messages=[{"role": "user", "content": prompt}]
    )
