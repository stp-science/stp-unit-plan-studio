# AI providers

Provider selection and keys are server settings, independent of the GitHub repository. The existing owner-private Site and its saved browser plans remain in place.

## Gemini trial

In the Site's hosted environment settings:

- `AI_PROVIDER`: `gemini`
- `GEMINI_MODEL`: `gemini-3.8-flash`
- `GEMINI_API_KEY`: the full Google AI Studio key, marked as a secret

Use a Google AI Studio project explicitly marked **Free Tier** for the free-quota trial. A key belonging to a paid project can incur charges; the website cannot determine billing tier from the key. Do not enable paid billing as part of the trial.

Google AI Studio: https://aistudio.google.com/api-keys

Redeploy the saved Site version after changing runtime settings. Keep keys out of chat, source, attachments and browser code. The server sends the key only in the `x-goog-api-key` header to Google's API, never in the URL.

Start with one small Year 7 Science guide using public Ministry statements, then assess purpose, summaries, learning objectives and vocabulary. Exact selected wording and teacher decisions are checked by the same code used for Claude. Do not assume a successful short guide validates an entire four-year curriculum. Review current free-tier data terms before sending internal school documents; Google's free-tier content may be used to improve its products.

Gemini uses structured JSON and streamed generation. Quota failures preserve completed years and saved guides. There is no automatic retry or fallback to the Claude account.

## Switch back to Claude

Set `AI_PROVIDER=claude`, retain `ANTHROPIC_API_KEY` as a secret and set `CLAUDE_MODEL` to an available model ID. Redeploy. Switching providers does not delete any plans or guide drafts.

## Limits and verification

Both providers are metered by tokens. Google's Free Tier offers free input/output within model-specific request and token quotas, rather than a Claude-style subscription allowance. Rate limits depend on the actual project, model and tier. See https://ai.google.dev/gemini-api/docs/billing and https://ai.google.dev/gemini-api/docs/rate-limits.

`npm test` includes mocked Gemini checks for secure authentication, PDF inputs, structured output, streaming, exact statement preservation, teacher decisions, truncation and provider isolation. It does not invoke either live provider. The Gemini connection still needs a real key and a separately reported live result.
