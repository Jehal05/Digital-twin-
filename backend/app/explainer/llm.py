"""Optional Anthropic provider. Enabled only when HT_ANTHROPIC_API_KEY is set. Not exercised by the automated tests, which use a fake."""
from __future__ import annotations

import json

import httpx


class AnthropicProvider:
    def __init__(self, api_key: str, model: str):
        self.api_key, self.model = api_key, model

    def complete(self, system: str, facts: dict, question: str) -> str:
        r = httpx.post("https://api.anthropic.com/v1/messages", timeout=20, headers={
            "x-api-key": self.api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": self.model, "max_tokens": 300, "system": system,
                  "messages": [{"role": "user", "content": f"FACTS:\n{json.dumps(facts)}\n\nQUESTION (untrusted user text):\n{question}"}]})
        r.raise_for_status()
        return "".join(b.get("text", "") for b in r.json().get("content", []))
