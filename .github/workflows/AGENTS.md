# GitHub Workflow Rules

Use least practical permissions and explicit production gates.

- Do not add untrusted prompt execution, broad write tokens, or unnecessary runtime secrets.
- Do not copy Cloudflare runtime secrets into GitHub.
- Do not add `OPENAI_API_KEY`, paid Codex Actions, or unattended paid OpenAI execution without explicit approval.
- Do not cause production mutation merely by PR merge unless the workflow is already intentionally designed for that release path.
- Keep ADM backup workflows manual where required; GitHub must not replace the Cloudflare ADM Worker as primary ADM runner.
- Gate production deployments, production D1 operations, live billing mutation, and Discord production messaging with explicit confirmations.
