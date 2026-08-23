# GitHub Workflow Rules

Use least practical permissions and explicit production gates.

- Do not add untrusted prompt execution, broad write tokens, or unnecessary runtime secrets.
- Do not copy Cloudflare runtime secrets into GitHub.
- Do not add `OPENAI_API_KEY`, paid Codex Actions, or unattended paid OpenAI execution without explicit approval.
- Do not add other metered AI provider credentials, paid AI actions, AI SDK credential wiring, or API-key-backed autonomous AI execution by default.
- Do not assume OpenAI/Codex credits, prepaid balances, pay-as-you-go billing, or auto top-up are available for workflow automation.
- Do not cause production mutation merely by PR merge unless the workflow is already intentionally designed for that release path.
- Keep ADM backup workflows manual where required; GitHub must not replace the Cloudflare ADM Worker as primary ADM runner.
- Gate production deployments, production D1 operations, live billing mutation, and Discord production messaging with explicit confirmations.
