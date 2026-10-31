# STP Unit Plan Studio

AI curriculum planning and topic guide generator for St Peter’s.

## Planning modes

1. Create a Years 7–10 curriculum overview from Ministry sources and a department brief, or import an existing overview.
2. Generate and adapt one topic guide using selected curriculum statements and practices.
3. Propose relevant capabilities and school priorities across a programme, then generate missing topic guides in a resumable batch.

Teachers review all drafts and retain control of assessment and tick-box decisions. Capability and priority coverage follows unit content rather than equal quotas.

## Source and hosting

This GitHub repository contains a snapshot of the current working website, its Word template, curriculum catalogue, tests and server code. Source was initially imported from deployed commit `2738361b0c01157451c3be5e9b08724468fab3d9` on 30 October 2026.

The existing owner-private trial is currently hosted at https://stp-unit-plan-studio-prototype.talbotino.chatgpt.site. Copying the code to GitHub does not change that hosting or connect automatic deployment from GitHub. Keep the existing project identity in `.openai/hosting.json` when updating that Site; do not create a replacement Site accidentally.

GitHub Pages alone cannot run the private Claude API connection. The active Claude backend is `worker/api.js`; `backend/` is a separate legacy integration and is not the programme workspace's Claude backend.

## Run and check

Requires a current Node.js version supporting the browser-compatible Web APIs used by the Worker.

```sh
npm test
npm run build
npm run validate
npm run dev
```

The build packages the server and assets into `dist/server/index.js`. These generated files are retained here to preserve the deployed snapshot. See `PROGRAMME-TRIAL.md` for the trial flows, limits and detailed setup.

## AI provider configuration

The current hosted trial uses Claude with `AI_PROVIDER=claude`, `CLAUDE_MODEL=claude-sonnet-5-5` and a secret `ANTHROPIC_API_KEY`. Gemini remains supported with `AI_PROVIDER=gemini`, `GEMINI_MODEL=gemini-3.5-flash-lite` and a secret `GEMINI_API_KEY`. No automatic fallback runs between providers. See [AI-PROVIDERS.md](AI-PROVIDERS.md) for setup, free-quota and data-term details. Redeploy after changing runtime settings.

Never put a real API key in this repository, the browser code, an attachment or a chat message. `.env.example` contains names only. The live trial's key and model are configured only in the hosting service, outside GitHub.

## Trial limitations

- Plans and uploads are stored in the user's browser. Use the built-in JSON backup/restore before changing browsers or clearing data. Plans are not shared or isolated by department accounts yet.
- The hosted trial remains owner-private. Staff access requires identity-scoped persistent storage and appropriate rate and budget controls before expanding the audience.
- School priority names and definitions still need to be confirmed in `worker/school-standard.js`. Programme mapping reports pending setup until these are configured.
- Ministry material includes draft/proposed sources. Provenance and version information are retained in the catalogue; staff must check applicability. Senior material is kept separate from junior curriculum statements and is used only as appropriate future-learning evidence.
- Overview generation prepares and reuses a stored curriculum index, then makes one compact planning request per year. AI returns statement references; the server inserts exact stored wording and provenance. The built-in Science index contains 326 knowledge and 119 practice records. Other documents are indexed once per source version and year in the Site's R2 `BUCKET` binding; those machine-extracted indexes require staff source review. Accepted plans and guides remain browser-local. Completed years are checkpointed and can resume after a failure.
- Topic guide generation also uses statement references to preserve selected wording. Missing overview references produce explicit coverage warnings. The current Science Year 7 live trial completed in 17 seconds, mapped all 73 stored records, and used 5,367 input tokens plus 1,586 output tokens; this is one trial, not a whole-school cost estimate.
- Keep `r2: "BUCKET"` in `.openai/hosting.json` when deploying on Sites. A different hosting platform must supply an equivalent storage binding; GitHub Pages alone cannot run this backend.
- Automated checks cover interrupted streams, stalled requests, cancellation, resumed year stages and exact selected statement retention. Generated curriculum drafts still require departmental review.

Third-party curriculum material and bundled vendor software retain their original attribution and licensing. This import does not add an open-source licence.
