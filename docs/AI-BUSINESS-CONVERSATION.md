# Business questions and clarification

The existing agent interprets free-form questions using the configured provider and role-filtered tools. The new conversation tools let it handle app guidance and missing details without accepting unverified model prose.

- `get_app_help` selects up to three reviewed topics: billing, products, inventory, customer credit, returns, reports, offline sync, Tally, payments, stock planning, profit versus cash, sales improvement and assistant capabilities. The server renders its own English/Hindi guidance by topic ID. This is general guidance, not a diagnosis, performance guarantee, or evidence that a shop has enabled a feature or completed an operation.
- `request_clarification` selects a missing field (product, customer, date range, quantity, amount, payment method, choice or topic). The server displays its own question and ends the model loop immediately. Previously a model's clarification could be discarded by response grounding and become a generic failure message.
- Follow-ups and compound questions receive the full set of tools permitted for the current shop, role and plan. First-turn report fast paths remain unchanged. Recent conversation helps interpret the question but is never trusted as current stock, balance or sales evidence.
- Prompt guidance explicitly covers informal wording, spelling mistakes, abbreviations, Hindi and Hinglish, and distinguishes asking how to make a change from authorizing a change.

Reads remain scoped and guarded; writes remain confirmation proposals and owner-PIN checks are unchanged. No unrestricted SQL, arbitrary URL fetching, cross-shop access or provider-written facts were introduced. Answers still depend on available data/tools and the chosen provider's understanding; this does not guarantee all questions or languages are supported.

Regressions cover visible clarification, zero extra model calls after clarification, grounded how-to answers, mixed evidence/questions, contextual tool availability, role and argument boundaries, and rejection of invented help text. Scripted-provider tests verify integration behavior, not a measured live-model accuracy percentage.
